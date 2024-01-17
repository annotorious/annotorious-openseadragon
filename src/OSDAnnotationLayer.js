import EventEmitter from 'tiny-emitter';
import OpenSeadragon from 'openseadragon';
import { SVG_NAMESPACE, addClass, hasClass, removeClass } from '@recogito/annotorious/src/util/SVG';
import DrawingTools from '@recogito/annotorious/src/tools/ToolsRegistry';
import { drawShape } from '@recogito/annotorious/src/selectors';
import { format } from '@recogito/annotorious/src/util/Formatting';
import { isTouchDevice, enableTouchTranslation } from '@recogito/annotorious/src/util/Touch';
import Crosshair from './OSDCrosshair';
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

    // Deprecate the old 'formatter' option 
    if (props.config.formatter)
      this.formatters = [ props.config.formatter ];
    else if (props.config.formatters)
      this.formatters = Array.isArray(props.config.formatters) ? 
        props.config.formatters : [ props.config.formatters ];

    this.disableSelect = props.config.disableSelect;
    this.drawOnSingleClick = props.config.drawOnSingleClick;

    this.svg = document.createElementNS(SVG_NAMESPACE, 'svg');

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

      const src = this.viewer.world.getItemAt(0).source['@id'] || 
        new URL(this.viewer.world.getItemAt(0).source.url, document.baseURI).href;

      this.env.image = {
        src, 
        naturalWidth: x,
        naturalHeight: y
      };

      if (props.config.crosshair) {
        if (!this.crosshair) {
          this.crosshair = new Crosshair(this.svg);
          addClass(this.svg, 'no-cursor');
        }
      }

      if (!this.loaded)
        this.emit('load', src);

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
    let started = false;
    
    let firstDragDone = false;

    let dragging = false;

    this.tools = new DrawingTools(this.g, this.config, this.env);

    this.tools.on('complete', shape => {
      firstDragDone = false;
      this.onDrawingComplete(shape);
    });

    this.mouseTracker = new OpenSeadragon.MouseTracker({
      element: this.svg,

      preProcessEventHandler: info => {
        if (!this.mouseTracker.enabled) {
          info.preventDefault = false;
          info.preventGesture = true;
        }

        if (this.selectedShape && info.eventType === 'wheel') {
          info.preventDefault = false;
          this.viewer.canvas.dispatchEvent(new info.originalEvent.constructor(info.eventType, info.originalEvent));
        }
      },

      pressHandler: evt => {
        if (!this.tools.current.isDrawing) {
          this.tools.current.start(evt.originalEvent, this.drawOnSingleClick && !this.hoveredShape);
          if (!gigapixelMode)
            this.scaleTool(this.tools.current);
        }
      },

      moveHandler: evt => {
        if (this.tools.current.isDrawing) {
          const { x , y } = this.tools.current.getSVGPoint(evt.originalEvent);
 
          if (!firstDragDone) {
            evt.originalEvent.stopPropagation();
          }

          this.tools.current.onMouseMove(x, y, evt.originalEvent);

          if (!started) {
            this.emit('startSelection', { x , y });
            started = true;
          }
          if (!dragging && this.tools.current.onDragStart) {
            this.tools.current.onDragStart(x, y, evt.originalEvent);

            dragging = true;
          }
        }
      },

      releaseHandler: evt => {
        if (this.tools.current.isDrawing) {
          // continue in dragging mode if moveHandler has not been fired
          // if (!started) return;
          const { x , y } = this.tools.current.getSVGPoint(evt.originalEvent);
          if (started) { 
            this.emit('endSelection', { x , y });
            firstDragDone = true;
          }
          this.tools.current.onMouseUp(x, y, evt.originalEvent);

          if (dragging && this.tools.current.onDragEnd)
            this.tools.current.onDragEnd();
        }

        started = false;

        dragging = false;
      }
    });

    // Draw mode hotkey
    const hotkey = this.config.hotkey ?
      (this.config.hotkey.key ? this.config.hotkey.key.toLowerCase() : this.config.hotkey.toLowerCase()) :
      'shift';

    // Inverted mode
    const inverted = this.config.hotkey?.inverted;
  
    this.mouseTracker.enabled = inverted;

    // Keep tracker disabled until Shift is held
    if (this.onKeyDown)
      document.removeEventListener('keydown', this.onKeyDown);
    
    if (this.onKeyUp)
      document.removeEventListener('keydown', this.onKeyDown);

    this.onKeyDown = evt => {
      if (evt.key.toLowerCase() === hotkey && !this.selectedShape) {
        const enabled = !this.readOnly && !inverted;
        this.mouseTracker.enabled = enabled;
        this.tools.current.enabled = enabled;
      }
    };

    this.onKeyUp = evt => {
      if (evt.key.toLowerCase() === hotkey && !this.tools.current.isDrawing) {
        this.mouseTracker.enabled = inverted;
        this.tools.current.enabled = inverted;
        firstDragDone = false;
      }
    };
        
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  _initMouseEvents = () => {
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
              const element = this.hoveredShape.element || this.hoveredShape;
              removeClass(element, 'hover');
              
              this.emit('mouseLeaveAnnotation', this.hoveredShape.annotation, this.hoveredShape);
            }

            if (shape) {
              addClass(shape, 'hover');
              this.emit('mouseEnterAnnotation', shape.annotation, shape);
            }
          }

          this.hoveredShape = shape;
        }
      }
    });

    this.svg.parentElement.addEventListener('mouseleave', () => {
      if (this.hoveredShape) {
        removeClass(this.hoveredShape, 'hover');
        this.emit('mouseLeaveAnnotation', this.hoveredShape.annotation, this.hoveredShape);
        this.hoveredShape = null;
      }
    });

    // Unfortunately, drag ALSO creates a click 
    // event - ignore in this case.
    let lastMouseDown = null;

    this.viewer.addHandler('canvas-press', () =>
      lastMouseDown = new Date().getTime());

    this.viewer.addHandler('canvas-click', evt => {
      const { originalEvent } = evt;

      // Click & no drawing in progress
      if (!(this.tools.current?.isDrawing || this.disableSelect)) {
        // Ignore "false click" after drag!
        const timeSinceMouseDown = new Date().getTime() - lastMouseDown;
        
        // Real click (no drag)
        if (timeSinceMouseDown < 250) {   
          // Click happened on the current selection?
          const isSelection = originalEvent.target.closest('.a9s-annotation.editable.selected');
          const hoveredShape = isSelection ? this.selectedShape : this._getShapeAt(originalEvent);

          // Ignore clicks on selection
          if (hoveredShape) {
            evt.preventDefaultAction = true; // No zoom on click
            this.selectShape(hoveredShape);
          } else if (!hoveredShape) {
            this.deselect();
            this.emit('select', {});
          }
        } 
      }

      if (this.disableSelect && this.hoveredShape)
        this.emit('clickAnnotation', this.hoveredShape.annotation, this.hoveredShape);
    });

  }

  /**
   * Helper - executes immediately if the tilesource is loaded,
   * or defers to after load if not
   */
  _lazy = fn => {
    if (this.viewer.world.getItemAt(0)) {
      fn();
    } else {
      const onLoad = () => {
        fn();
        this.viewer.removeHandler('open', onLoad);
        this.viewer.world.removeHandler('add-item', onLoad);
      };

      this.viewer.addHandler('open', onLoad);
      this.viewer.world.addHandler('add-item', onLoad);
    }
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
    
    format(shape, annotation, this.formatters);
    this.scaleFormatterElements(shape);
    
    return shape;
  }

  addDrawingTool = plugin =>
    this.tools.registerTool(plugin);

  addOrUpdateAnnotation = (annotation, previous) => {
    const selected = this.selectedShape?.annotation;
    if (selected === annotation || selected?.isSelection || selected == previous)
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
      } else {
        // Non-editable shape or read-only
        removeClass(this.selectedShape, 'selected');
      }
      
      this.selectedShape = null;
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

  // Common code for fitBounds and fitBoundsWithConstraints
  _fit = (annotationOrId, opts, fn) => {
    const shape = this.findShape(annotationOrId);
    if (shape) {
      const immediately = opts ? (
        typeof opts == 'boolean' ? opts : opts.immediately
      ) : false; 

      const padding = (opts?.padding || 0);
      
      const containerBounds = this.viewer.container.getBoundingClientRect();

      const paddingRelative = Math.min(
        2 * padding / containerBounds.width,
        2 * padding / containerBounds.height
      );

      const { x, y, width, height } = shape.getBBox(); // SVG element bounds, image coordinates

      const padX = x - paddingRelative * width;
      const padY = y - paddingRelative * height;
      const padW = width + 2 * paddingRelative * width;
      const padH = height + 2 * paddingRelative * height;

      const rect = this.viewer.viewport.imageToViewportRectangle(padX, padY, padW, padH);
      this.viewer.viewport[fn](rect, immediately);
    }    
  }

  fitBounds = (annotationOrId, immediately) =>
    this._fit(annotationOrId, immediately, 'fitBounds');

  fitBoundsWithConstraints = (annotationOrId, immediately) =>
    this._fit(annotationOrId, immediately, 'fitBoundsWithConstraints');

  getAnnotations = () => {
    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation'));
    return shapes.map(s => s.annotation);
  }

  getAnnotationsIntersecting = annotationOrId => {
    const annotation = annotationOrId.id ? annotationOrId : this.findShape(annotationOrId).annotation;
    return this.store.getAnnotationsIntersecting(annotation);
  }

  getImageSnippetById = annotationId => {
    const shape = this.findShape(annotationId);
    if (shape)
      return getSnippet(this.viewer, shape);
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

    this.store.clear();

    this._lazy(() => {
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
    });
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

    if (this.tools?.current)
      this.scaleTool(this.tools.current);
  }
  
  scaleFormatterElements = opt_shape => {
    const scale = 1 / this.currentScale();

    if (opt_shape) {
      const el = opt_shape.querySelector('.a9s-annotation:not(.a9s-non-scaling) .a9s-formatter-el');
      if (el)
        el.firstChild.setAttribute('transform', `scale(${scale})`);
    } else {
      const elements = Array.from(this.g.querySelectorAll('.a9s-annotation:not(.a9s-non-scaling) .a9s-formatter-el'));
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

        this.selectedShape = toolForAnnotation.createEditableShape(annotation, this.formatters);
        this.scaleTool(this.selectedShape);

        this.scaleFormatterElements(this.selectedShape.element);

        this.selectedShape.element.annotation = annotation;  

        // Disable normal OSD nav
        const editableShapeMouseTracker = new OpenSeadragon.MouseTracker({
          element: this.svg,

          preProcessEventHandler: info => {
            info.stopPropagation = true;
            info.preventDefault = false;
            info.preventGesture = true;
          }
        }).setTracking(false);

        // En-/disable OSD nav based on hover status
        this.selectedShape.element.addEventListener('mouseenter', () => {
          this.hoveredShape = this.selectedShape;
          editableShapeMouseTracker.setTracking(true);
        });

        this.selectedShape.element.addEventListener('mouseleave', () => {
          this.hoveredShape = null;
          editableShapeMouseTracker.setTracking(false);
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
      addClass(shape, 'selected');

      if (!skipEvent)
        this.emit('select', { annotation, element: shape, skipEvent });   
    }
  }

  setDrawingEnabled = enable => {
    if (this.mouseTracker) {
      const enabled = enable && !this.readOnly;
      this.mouseTracker.enabled = enabled;
      this.mouseTracker.setTracking(enabled);
      if (this.tools.current)
        this.tools.current.enabled = enabled;
    }
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

  stopDrawing = () => {
    if (this.tools?.current) {
      if (this.tools.current.isDrawing)
        this.tools.current.stop();
  
      this.mouseTracker.enabled = false;
      this.tools.current.enabled = false; 
    }
  }

}

export default class OSDAnnotationLayer extends AnnotationLayer {

  constructor(props) {
    super(props);
    this._initDrawingTools();
  }

  onDrawingComplete = shape => {
    this.mouseTracker.enabled = this.config.hotkey?.inverted;
    this.selectShape(shape);
    this.emit('createSelection', shape.annotation);
  }

}