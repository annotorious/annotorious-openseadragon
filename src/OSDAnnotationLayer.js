import EventEmitter from 'tiny-emitter';
import OpenSeadragon from 'openseadragon';
import { SVG_NAMESPACE, addClass, hasClass, removeClass } from '@recogito/annotorious/src/util/SVG';
import DrawingTools from '@recogito/annotorious/src/tools/ToolsRegistry';
import Crosshair from '@recogito/annotorious/src/Crosshair';
import { drawShape } from '@recogito/annotorious/src/selectors';
import { format } from '@recogito/annotorious/src/util/Formatting';
import { isTouchDevice, enableTouchTranslation } from '@recogito/annotorious/src/util/Touch';
import AnnotationStore from './AnnotationStore';
import { getSnippet } from './util/ImageSnippet';

const isTouch = isTouchDevice();

/**
 * Code shared between (normal) OSDAnnotationLayer and
 * GigapixelAnnotationLayer
 */
export class AnnotationLayer extends EventEmitter {

  constructor(props) {
    super();

    this.viewer = props.viewer;

    this.config = props.config;
    this.env = props.env;

    this.readOnly = props.config.readOnly;
    this.headless = props.config.headless;
    this.formatter = props.config.formatter;
    this.invertDrawingMode = props.config.invertDrawingMode;

    this.disableSelect = props.disableSelect;
    this.drawOnSingleClick = props.config.drawOnSingleClick;

    this.svg = document.createElementNS(SVG_NAMESPACE, 'svg');

    // Unfortunately, drag ALSO creates a click 
    // event - ignore in this case.
    let lastMouseDown = null;
    let tempSelectionBlock = null;

    if (isTouch) {
      this.svg.setAttribute('class', 'a9s-annotationlayer a9s-osd-annotationlayer touch');
      enableTouchTranslation(this.svg);
    } else {
      this.svg.setAttribute('class', 'a9s-annotationlayer a9s-osd-annotationlayer');
    }    

    this.g = document.createElementNS(SVG_NAMESPACE, 'g');

    this.svg.appendChild(this.g);
    
    this.viewer.canvas.appendChild(this.svg);

    this.viewer.addHandler('animation', () => this.resize());
    this.viewer.addHandler('rotate', () => this.resize());
    this.viewer.addHandler('resize', () => this.resize());
    this.viewer.addHandler('flip', () => this.resize());

    this.loaded = false;

    const onLoad = () => {
      const { x, y } = this.viewer.world.getItemAt(0).source.dimensions;

      this.env.image = {
        src: this.viewer.world.getItemAt(0).source['@id'] || 
          new URL(this.viewer.world.getItemAt(0).source.url, document.baseURI).href,
        naturalWidth: x,
        naturalHeight: y
      };

      if (props.config.crosshair) {
        this.crosshair = new Crosshair(this.g, x, y);
        addClass(this.svg, 'has-crosshair');
      }

      this.loaded = true;

      this.g.style.display = 'inline';

      this.resize();      
    }

    // Store image properties on open (incl. after page change) and on addTiledImage
    this.viewer.addHandler('open', onLoad);
    this.viewer.world.addHandler('add-item', onLoad);

    // Or: if Annotorious gets initialized on a loaded image
    if (this.viewer.world.getItemAt(0))
      onLoad();

    this.store = new AnnotationStore(this.env);

    this.selectedShape = null;

    this.hoveredShape = null;

    this._initMouseEvents();
  }

  _getShapeAt = evt => {
    const getSVGPoint = evt => {
      const pt = this.svg.createSVGPoint();
  
      if (window.TouchEvent && (evt instanceof TouchEvent)) {
        const bbox = this.svg.getBoundingClientRect();

        const e = evt.touches[0];
        const x = e.clientX - bbox.x;
        const y = e.clientY - bbox.y;
  
        const { left, top } = this.svg.getBoundingClientRect();
        pt.x = x + left;
        pt.y = y + top;
  
        return pt.matrixTransform(this.g.getScreenCTM().inverse());
      } else {
        pt.x = evt.offsetX;
        pt.y = evt.offsetY;
  
        return pt.matrixTransform(this.g.getCTM().inverse());
      }
    }

    const { x, y } = getSVGPoint(evt);

    const annotation = this.store.getAnnotationAt(x, y, this.currentScale());
    if (annotation)
      return this.findShape(annotation);
  }

  /** Initializes the OSD MouseTracker used for drawing **/
  _initDrawingTools = gigapixelMode => {
    this.tools = new DrawingTools(this.g, this.config, this.env);
    this.tools.on('complete', this.onDrawingComplete);

    let started = false;
    
    this.mouseTracker = new OpenSeadragon.MouseTracker({
      element: this.svg,

      pressHandler: evt => {
        if (!this.tools.current.isDrawing) {
          this.lastMouseDown = new Date().getTime();
          this.tools.current.start(evt.originalEvent, this.drawOnSingleClick && !this.hoveredShape);
          if (!gigapixelMode)
            this.scaleTool(this.tools.current);
        }
      },

      moveHandler: evt => {
        if (this.tools.current.isDrawing) {
          const { x , y } = this.tools.current.getSVGPoint(evt.originalEvent);
          this.tools.current.onMouseMove(x, y, evt.originalEvent);

          if (!started) {
            this.emit('startSelection', { x , y });
            started = true;
          }
        }
      },

      releaseHandler: evt => {
        if (this.tools.current.isDrawing) {
          const { x , y } = this.tools.current.getSVGPoint(evt.originalEvent);
          this.tools.current.onMouseUp(x, y, evt.originalEvent);
          if(started) {
            // Block next click from selecting ghost annotation
            this.tempSelectionBlock = true;
          }
        }

        started = false;
      }
    }).setTracking(this.invertDrawingMode);

    // Enable or disable tracker depending on the shift key's position and drawing mode
    if (this.onKeyDown)
      document.removeEventListener('keydown', this.onKeyDown);
    
    if (this.onKeyUp)
      document.removeEventListener('keydown', this.onKeyDown);

    this.onKeyDown = evt => {
      if (evt.which === 16 && !this.tools.current.isDrawing && !this.selectedShape) { // Shift
        this.mouseTracker.setTracking(!this.readOnly && !this.invertDrawingMode);
      }
    };

    this.onKeyUp = evt => {
      if (evt.which === 16 && !this.tools.current.isDrawing && !this.selectedShape) {
        this.mouseTracker.setTracking(!this.readOnly && this.invertDrawingMode);
      }
    };
    
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  _initMouseEvents = () => {
    // User-configured OSD zoom gesture setting
    let zoomGesture = this.viewer.gestureSettingsByDeviceType('mouse').clickToZoom;

    // We use mouse-move to track which annotation is currently hovered on.
    // Keep in mind that annotations are NOT automatically stacked from large
    // to small. Therefore, smaller ones might be obscured underneath larger
    // ones. That's the reason we can't use native mouseEnter/mouseLeave events
    // on the SVG shapes! 
    this.svg.addEventListener('mousemove', evt => {
      // Don't track mouseEnter/mouseLeave while drawing
      if (!this.tools?.current.isDrawing) {
        // Don't do anything if the move happens over the current selection
        const isMoveSelection = evt.target.closest('.a9s-annotation.editable.selected');

        if (!isMoveSelection) {
          const shape = this._getShapeAt(evt);

          // Hovered annotation changed
          if (shape?.annotation !== this.hoveredShape?.annotation) {
            if (this.hoveredShape) {
              this.viewer.gestureSettingsByDeviceType('mouse').clickToZoom = zoomGesture;
              
              const element = this.hoveredShape.element || this.hoveredShape;
              removeClass(element, 'hover');
              
              this.emit('mouseLeaveAnnotation', this.hoveredShape.annotation, this.hoveredShape);
            }

            if (shape) {
              zoomGesture = this.viewer.gestureSettingsByDeviceType('mouse').clickToZoom;
              this.viewer.gestureSettingsByDeviceType('mouse').clickToZoom = false;
              addClass(shape, 'hover');
              this.emit('mouseEnterAnnotation', shape.annotation, shape);
            }
          }

          this.hoveredShape = shape;
        }
      }
    });

    new OpenSeadragon.MouseTracker({
      element: this.viewer.canvas,

      pressHandler: () => {
        this.lastMouseDown = new Date().getTime();
      }
    });

    this.svg.addEventListener('mousedown', () => {
      this.lastMouseDown = new Date().getTime();
    });

    const onClick = evt => {

      // Ignore click after releasing drawing tool
      if(!this.tempSelectionBlock) {
        // Click & no drawing in progress
        if (!(this.tools.current?.isDrawing || this.disableSelect)) {
          // Ignore "false click" after drag!
          const timeSinceMouseDown = new Date().getTime() - this.lastMouseDown;
  
          // Real click (no drag)
          if (timeSinceMouseDown < 250) {   
            // Click happened on the current selection?
            const isSelection = evt.target.closest('.a9s-annotation.editable.selected');
            const hoveredShape = isSelection ? this.selectedShape : this._getShapeAt(evt);
  
            // Ignore clicks on selection
            if (hoveredShape) {
              this.selectShape(hoveredShape);
            } else if (!hoveredShape) {
              this.deselect();
              this.emit('select', {});
            }
          }
        }
      } else {
        // Consume selection block
        this.tempSelectionBlock = false;
      }

      if (this.disableSelect)
        this.emit('clickAnnotation', this.hoveredShape.annotation, this.hoveredShape);
    };

    this.svg.addEventListener('click', onClick);
    this.svg.addEventListener('touchstart', onClick);
  }

  _refreshNonScalingAnnotations = () => {
    const scale = this.currentScale();
    Array.from(this.svg.querySelectorAll('.a9s-non-scaling')).forEach(shape =>
      // This could check if the shape is actually inside the viewport.
      // However, the lookup might be just as costly as setting the attribute.
      // Alternatively, a future implementation of the annotation store which caches 
      // the bounds might be able to provide this info without a DOM lookup.
      // Either way: this is for the future. No need to optimize prematurely.
      shape.setAttribute('transform', `scale(${1 / scale})`));
  }

  /** 
   * Adds an annotation to the annotation layer.
   * Returns the shape for convenience. 
   */
  addAnnotation = (annotation, optBuffer) => {
    const g = optBuffer || this.g;

    const shape = drawShape(annotation, this.env.image);
    addClass(shape, 'a9s-annotation');

    shape.setAttribute('data-id', annotation.id);
    shape.annotation = annotation;

    g.appendChild(shape);
    
    format(shape, annotation, this.formatter);
    this.scaleFormatterElements(shape);
    
    return shape;
  }

  addDrawingTool = plugin =>
    this.tools.registerTool(plugin);

  addOrUpdateAnnotation = (annotation, previous) => {
    if (this.selectedShape?.annotation === annotation || this.selectedShape?.annotation == previous)
      this.deselect();
  
    if (previous)
      this.removeAnnotation(annotation);

    this.removeAnnotation(annotation);

    const shape = this.addAnnotation(annotation);
    if (hasClass(shape, 'a9s-non-scaling'))
      shape.setAttribute('transform', `scale(${1 / this.currentScale()})`);

    this.store.insert(annotation);
  }

  currentScale = () => {
    const containerWidth = this.viewer.viewport.getContainerSize().x;
    const zoom = this.viewer.viewport.getZoom(true);
    return zoom * containerWidth / this.viewer.world.getContentFactor();
  }

  deselect = () => {
    this.tools?.current.stop();
    
    if (this.selectedShape) {
      const { annotation } = this.selectedShape;

      if (this.selectedShape.destroy) {
        // Modifiable shape: destroy and re-add the annotation
        this.selectedShape.mouseTracker.destroy();
        this.selectedShape.destroy();

        if (!annotation.isSelection) {
          const shape = this.addAnnotation(annotation);
          if (hasClass(shape, 'a9s-non-scaling'))
            shape.setAttribute('transform', `scale(${1 / this.currentScale()})`);
        }
      }
      
      this.selectedShape = null;
      this.mouseTracker.setTracking(this.invertDrawingMode && !this.readOnly);
    }
  }

  destroy = () => {
    this.deselect();
    this.svg.parentNode.removeChild(this.svg);
  }

  findShape = annotationOrId => {
    const id = annotationOrId?.id ? annotationOrId.id : annotationOrId;
    return this.g.querySelector(`.a9s-annotation[data-id="${id}"]`);
  }

  fitBounds = (annotationOrId, immediately) => {
    const shape = this.findShape(annotationOrId);
    if (shape) {
      const { x, y, width, height } = shape.getBBox(); // SVG element bounds, image coordinates
      const rect = this.viewer.viewport.imageToViewportRectangle(x, y, width, height);
      this.viewer.viewport.fitBounds(rect, immediately);
    }    
  }

  getAnnotations = () => {
    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation'));
    return shapes.map(s => s.annotation);
  }

  getSelectedImageSnippet = () => {
    if (this.selectedShape) {
      const shape = this.selectedShape.element ?? this.selectedShape;
      return getSnippet(this.viewer, shape);
    }
  }

  init = annotations => {
    // Clear existing
    this.deselect();

    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation'));
    shapes.forEach(s => this.g.removeChild(s));

    // Draw annotations
    console.time('Took');
    console.log('Drawing...');

    if (!this.loaded)
      this.g.style.display = 'none';

    annotations.forEach(annotation => this.addAnnotation(annotation));

    // Insert into store (and spatial index)
    console.log('Indexing...')
    this.store.insert(annotations);
    console.timeEnd('Took');

    this.resize(); 
  }

  listDrawingTools = () =>
    this.tools.listTools();

  overrideId = (originalId, forcedId) => {
    // Update SVG shape data attribute
    const shape = this.findShape(originalId);
    shape.setAttribute('data-id', forcedId);

    // Update annotation
    const { annotation } = shape;

    const updated = annotation.clone({ id : forcedId });
    shape.annotation = updated;

    // Update spatial index
    this.store.remove(annotation);
    this.store.insert(updated);

    return updated;
  }

  panTo = (annotationOrId, immediately) => {
    const shape = this.findShape(annotationOrId);
    if (shape) {
      const { top, left, width, height } = shape.getBoundingClientRect();

      const x = left + width / 2 + window.scrollX;
      const y = top + height / 2 + window.scrollY;
      const center = this.viewer.viewport.windowToViewportCoordinates(new OpenSeadragon.Point(x, y));

      this.viewer.viewport.panTo(center, immediately);
    }    
  }

  removeAnnotation = annotationOrId => {
    // Removal won't work if the annotation is currently selected - deselect!
    const id = annotationOrId.type ? annotationOrId.id : annotationOrId;

    if (this.selectedShape?.annotation.id === id)
      this.deselect();
      
    const toRemove = this.findShape(annotationOrId);

    if (toRemove) {
      const { annotation } = toRemove;

      if (this.selectedShape?.annotation === annotation)
        this.deselect();

      toRemove.parentNode.removeChild(toRemove);

      // Remove from spatial tree!
      this.store.remove(annotation);
    }
  }
  
  removeDrawingTool = id =>
    this.tools?.unregisterTool(id);

  resize() {
    const flipped = this.viewer.viewport.getFlip();

    const p = this.viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0), true);
    if (flipped)
      p.x = this.viewer.viewport._containerInnerSize.x - p.x;

    const scaleY = this.currentScale();
    const scaleX = flipped ? - scaleY : scaleY;
    const rotation = this.viewer.viewport.getRotation();

    this.g.setAttribute('transform', `translate(${p.x}, ${p.y}) scale(${scaleX}, ${scaleY}) rotate(${rotation})`);

    this._refreshNonScalingAnnotations();
    this.scaleFormatterElements();

    if (this.selectedShape) {
      if (this.selectedShape.element) { // Editable shape
        this.scaleTool(this.selectedShape);
        this.emit('viewportChange', this.selectedShape.element);
      } else {
        this.emit('viewportChange', this.selectedShape); 
      }       
    }

    if (this.tools?.current.isDrawing)
      this.scaleTool(this.tools.current);
  }
  
  scaleFormatterElements = opt_shape => {
    const scale = 1 / this.currentScale();

    if (opt_shape) {
      const el = opt_shape.querySelector('.a9s-formatter-el');
      if (el)
        el.firstChild.setAttribute('transform', `scale(${scale})`);
    } else {
      const elements = Array.from(this.g.querySelectorAll('.a9s-formatter-el'));
      elements.forEach(el =>
        el.firstChild.setAttribute('transform', `scale(${scale})`));
    }
  }

  scaleTool = tool => {
    if (tool) {
      const scale = 1 / this.currentScale();
      tool.scale = scale;

      if (tool.onScaleChanged)
        tool.onScaleChanged(scale);
    }
  }

  selectAnnotation = (annotationOrId, skipEvent) => {
    if (this.selectedShape)
      this.deselect();

    const selected = this.findShape(annotationOrId);

    if (selected) {
      this.selectShape(selected, skipEvent);

      const element = this.selectedShape.element ? 
        this.selectedShape.element : this.selectedShape;

      return { annotation: selected.annotation, element };
    } else {
      this.deselect();
    }
  }

  selectShape = (shape, skipEvent) => {
    if (!skipEvent && !shape.annotation.isSelection)
      this.emit('clickAnnotation', shape.annotation, shape);
  
    // Don't re-select
    if (this.selectedShape?.annotation === shape.annotation)
      return;

    // If another shape is currently selected, deselect first
    if (this.selectedShape && this.selectedShape.annotation !== shape.annotation)
      this.deselect();

    const { annotation } = shape;

    const readOnly = this.readOnly || annotation.readOnly;

    this.mouseTracker.setTracking(false);

    if (!(readOnly || this.headless)) {
      const toolForAnnotation = this.tools.forAnnotation(annotation);

      if (toolForAnnotation) {
        setTimeout(() => {
          shape.parentNode.removeChild(shape);

          // Fire the event AFTER the original shape was removed. Otherwise,
          // people calling `.getAnnotations()` in the `onSelectAnnotation` 
          // handler will receive a duplicate annotation
          // (See issue https://github.com/recogito/annotorious-openseadragon/issues/63)
          if (!skipEvent)
            this.emit('select', { annotation, element: this.selectedShape.element });
        }, 1);

        this.selectedShape = toolForAnnotation.createEditableShape(annotation);
        this.scaleTool(this.selectedShape);

        this.scaleFormatterElements(this.selectedShape.element);

        this.selectedShape.element.annotation = annotation;     

        // Disable normal OSD nav
        const editableShapeMouseTracker = new OpenSeadragon.MouseTracker({
          element: this.svg
        }).setTracking(true);

        // En-/disable OSD nav based on hover status
        this.selectedShape.element.addEventListener('mouseenter', () => {
          this.hoveredShape = this.selectedShape;
          editableShapeMouseTracker.setTracking(true)
        });

        this.selectedShape.element.addEventListener('mouseleave', () => {
          this.hoveredShape = null;
          editableShapeMouseTracker.setTracking(false)
        });

        this.selectedShape.mouseTracker = editableShapeMouseTracker;

        this.selectedShape.on('update', fragment =>
          this.emit('updateTarget', this.selectedShape.element, fragment));
      } else {
        this.selectedShape = shape;

        if (!skipEvent)
          this.emit('select', { annotation, element: this.selectedShape });
      }
    } else {
      this.selectedShape = shape;

      if (!skipEvent)
        this.emit('select', { annotation, element: shape, skipEvent });   
    }
  }

  setDrawingEnabled = enable =>
    this.mouseTracker?.setTracking(enable && !this.readOnly);

  setInvertDrawingMode = enable => {
    this.invertDrawingMode = enable;
    this.mouseTracker.setTracking(this.invertDrawingMode && !this.readOnly);
  }
  
  setDrawingTool = shape => {
    if (this.tools) {
      this.tools.current?.stop();
      this.tools.setCurrent(shape);
    }
  }

  setVisible = visible => {
    if (visible) {
      this.svg.style.display = null;
    } else {
      this.deselect();
      this.svg.style.display = 'none';
    }
  }

  stopDrawing = () =>
    this.tools?.current?.stop();

}

export default class OSDAnnotationLayer extends AnnotationLayer {

  constructor(props) {
    super(props);
    this._initDrawingTools();
  }

  onDrawingComplete = shape => {
    this.selectShape(shape);
    this.emit('createSelection', shape.annotation);
    this.mouseTracker.setTracking(this.invertDrawingMode && !this.selectedShape);
  }

}