import EventEmitter from 'tiny-emitter';
import OpenSeadragon from 'openseadragon';
import { SVG_NAMESPACE } from '@recogito/annotorious/src/util/SVG';
import DrawingTools from '@recogito/annotorious/src/tools/ToolsRegistry';
import { drawShape, shapeArea } from '@recogito/annotorious/src/selectors';
import { format } from '@recogito/annotorious/src/util/Formatting';
import { isTouchDevice, enableTouchTranslation } from '@recogito/annotorious/src/util/Touch';
import { getSnippet } from './util/ImageSnippet';

export default class OSDAnnotationLayer extends EventEmitter {

  constructor(props) {
    super();

    this.viewer = props.viewer;

    this.readOnly = props.config.readOnly;
    this.headless = props.config.headless;
    this.formatter = props.config.formatter;
    this.deferredAnnotations = [];

    this.svg = document.createElementNS(SVG_NAMESPACE, 'svg');

    if (isTouchDevice()) {
      this.svg.setAttribute('class', 'a9s-annotationlayer a9s-osd-annotationlayer touch');
      enableTouchTranslation(this.svg);
    } else {
      this.svg.setAttribute('class', 'a9s-annotationlayer a9s-osd-annotationlayer');
    }    

    this.g = document.createElementNS(SVG_NAMESPACE, 'g');
    this.svg.appendChild(this.g);
    
    this.viewer.canvas.appendChild(this.svg);

    this.viewer.addHandler('animation', () => this.resizeAnnotationLayers());
    this.viewer.addHandler('rotate', () => this.resizeAnnotationLayers());
    this.viewer.addHandler('resize', () => this.resizeAnnotationLayers());
    this.viewer.addHandler('flip', () => this.resizeAnnotationLayers());

    // Store image properties on open and after page change
    this.viewer.addHandler('open',  () => {
      const { x, y } = this.viewer.world.getItemAt(0).source.dimensions;

      props.env.image = {
        src: this.viewer.world.getItemAt(0).source['@id'] || 
          new URL(this.viewer.world.getItemAt(0).source.url, document.baseURI).href,
        naturalWidth: x,
        naturalHeight: y
      };

      // In collectionMode, use separate drawing tools for
      // separate images
      if(this.viewer.collectionMode) {
        const itemCount = this.viewer.world.getItemCount();
        for (let i = 1; i < itemCount; i++){
          const tileSource = this.viewer.world.getItemAt(i);
          const {x, y} = tileSource.source.dimensions;
          const env = Object.assign({}, props.env);
          env.image = {
            src: tileSource.source['@id'] || 
              new URL(tileSource.source.url, document.baseURI).href,
            naturalWidth: x,
            naturalHeight: y
          };
          const g = document.createElementNS(SVG_NAMESPACE, 'g');
          const tools = new DrawingTools(g, props.config, env);
          this.annotationTools.push([g, tools]);
          this.svg.appendChild(g);
        }
      }

      // Sometimes addAnnotation is called before the images are loaded
      //  into the viewer. Keep track of those and Add them later.
      this.deferredAnnotations.forEach(anno => this.addAnnotation(anno));
      this.deferredAnnotations = [];

      this.resizeAnnotationLayers();      
    });

    // Clear annotation layer on page change 
    // Note: page change will also trigger 'open' - page size gets 
    // updated automatically
    this.viewer.addHandler('page', evt => {
      this.init([]);
      this.emit('pageChange');
    });

    this.selectedShape = null;

    this.tools = new DrawingTools(this.g, props.config, props.env);
    this.annotationTools = [[this.g, this.tools]];

    this._initDrawingMouseTracker();
  }

  _getTiledImageFromUrl = url => {
    const itemsCount = this.viewer.world.getItemCount();
    for(let i = 0; i < itemsCount; i++) {
      const tiledImage = this.viewer.world.getItemAt(i);
      if(tiledImage.source.url === url) {
        return tiledImage;
      }
    }
  }

  _getLayerByAnnotationTarget = annotation => {
    const targetUrl = annotation.target.source;
    const tileSource = this._getTiledImageFromUrl(targetUrl);
    return tileSource ? this.annotationTools[this.viewer.world.getIndexOfItem(tileSource)]: this.annotationTools[0];
  }

  /** Initializes the OSD MouseTracker used for drawing **/
  _initDrawingMouseTracker = () => {

    let started = false;

    this.mouseTracker = new OpenSeadragon.MouseTracker({
      element: this.svg,

      pressHandler: evt => {
        if (!this.tools.current.isDrawing)
          this.tools.current.start(evt.originalEvent);
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
        }

        started = false;
      }
    }).setTracking(false);

    this.tools.on('complete', shape => { 
      this.mouseTracker.setTracking(false);
      this.selectShape(shape);
      this.emit('createSelection', shape.annotation);
    });

    // Keep tracker disabled until Shift is held
    document.addEventListener('keydown', evt => {
      if (evt.which === 16 && !this.selectedShape) // Shift
        this.mouseTracker.setTracking(!this.readOnly);
    });

    document.addEventListener('keyup', evt => {
      if (evt.which === 16 && !this.tools.current.isDrawing)
        this.mouseTracker.setTracking(false);
    });
  }

  addAnnotation = annotation => {
    if(!this.viewer.isOpen()) {
      this.deferredAnnotations.push(annotation);
      return;
    }
    const [targetLayer, targetTool] = this._getLayerByAnnotationTarget(annotation);

    const shape = drawShape(annotation);
    shape.setAttribute('class', 'a9s-annotation');

    shape.setAttribute('data-id', annotation.id);
    shape.annotation = annotation;

    shape.addEventListener('mouseenter', evt => {
      if (!targetTool?.current.isDrawing)
        this.emit('mouseEnterAnnotation', annotation, evt);
    });

    shape.addEventListener('mouseleave', evt => {
      if (!targetTool?.current.isDrawing)
        this.emit('mouseLeaveAnnotation', annotation, evt);
    });

    shape.mouseTracker = new OpenSeadragon.MouseTracker({
      element: shape,
      clickHandler: () => this.selectShape(shape)
    }).setTracking(true);

    

    targetLayer.appendChild(shape);

    format(shape, annotation, this.formatter);

    this.scaleFormatterElements(shape);
  }

  addDrawingTool = plugin =>
    this.tools.registerTool(plugin);

  addOrUpdateAnnotation = (annotation, previous) => {
    if (this.selectedShape?.annotation === annotation || this.selectShape?.annotation == previous)
      this.deselect();
  
    if (previous)
      this.removeAnnotation(annotation);

    this.removeAnnotation(annotation);
    this.addAnnotation(annotation);

    // Make sure rendering order is large-to-small
    this.redraw();
  }

  currentScale = (item) => {
    const containerWidth = this.viewer.viewport.getContainerSize().x;
    const zoom = this.viewer.viewport.getZoom(true);
    let contentFactor = this.viewer.world.getContentFactor();
    if (item) {
      contentFactor = item.getContentSize().x / item.getBounds().width;
    }
    return zoom * containerWidth / contentFactor;
  }

  deselect = skipRedraw => {
    this.tools?.current.stop();
    
    if (this.selectedShape) {
      const { annotation } = this.selectedShape;

      if (this.selectedShape.destroy) {
        // Modifiable shape: destroy and re-add the annotation
        this.selectedShape.mouseTracker.destroy();
        this.selectedShape.destroy();

        if (!annotation.isSelection)
          this.addAnnotation(annotation);

          if (!skipRedraw)
            this.redraw();
      }
      
      this.selectedShape = null;
    }
  }

  destroy = () => {
    this.deselect();
    this.mouseTracker.destroy();
    this.svg.parentNode.removeChild(this.svg);
  }

  findShape = annotationOrId => {
    const id = annotationOrId?.id ? annotationOrId.id : annotationOrId;
    const svgLayers = this.annotationTools.map(([g, tool]) => g);
    return svgLayers
      .map(g => g.querySelector(`.a9s-annotation[data-id="${id}"]`))
      .find(shapeEl => !!shapeEl);
  }

  fitBounds = (annotationOrId, immediately) => {
    const shape = this.findShape(annotationOrId);
    if (shape) {
      const annotation = shape.annotation;
      const tileSource = this._getTiledImageFromUrl(annotation.target.source);

      const { x, y, width, height } = shape.getBBox(); // SVG element bounds, image coordinates
      let rect = this.viewer.viewport.imageToViewportRectangle(x, y, width, height);

      if(tileSource) {
        rect = tileSource.imageToViewportRectangle(x, y, width, height);
      }

      this.viewer.viewport.fitBounds(rect, immediately);
    }    
  }

  getAnnotationToolsShapes = () => {
    const svgLayers = this.annotationTools.map(([g, tool]) => g);
    return svgLayers.map(g => Array.from(g.querySelectorAll('.a9s-annotation')));
  }

  getAnnotations = () => {
    const shapes = this.getAnnotationToolsShapes();
    return shapes.flat().map(s => s.annotation);
  }

  getSelected = () => {
    if (this.selectedShape) {
      const { annotation } = this.selectedShape;
      const element = this.selectedShape.element || this.selectedShape;
      return { annotation, element };
    }
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

    const shapes = this.getAnnotationToolsShapes();
    this.annotationTools.forEach(([g, tool], index) => {
      shapes[index].forEach(shape => g.removeChild(shape));
    });

    // Add
    annotations.sort((a, b) => shapeArea(b) - shapeArea(a));
    annotations.forEach(this.addAnnotation);
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

  redraw = () => {
    const shapes = this.getAnnotationToolsShapes();

    const annotations = shapes.flat().map(s => s.annotation);
    annotations.sort((a, b) => shapeArea(b) - shapeArea(a));

    // Clear the SVG element
    this.annotationTools.forEach(([g, tool], index) => {
      shapes[index].forEach(s => g.removeChild(s));
    });
    // Redraw
    annotations.forEach(this.addAnnotation);
  }
  
  removeAnnotation = annotationOrId => {
    // Removal won't work if the annotation is currently selected - deselect!
    const id = annotationOrId.type ? annotationOrId.id : annotationOrId;

    if (this.selectedShape?.annotation.id === id)
      this.deselect();
      
    const toRemove = this.findShape(annotationOrId);

    if (toRemove) {
      if (this.selectedShape?.annotation === toRemove.annotation)
        this.deselect();

      toRemove.mouseTracker.destroy();
      toRemove.parentNode.removeChild(toRemove);
    }
  }

  resizeAnnotationLayers() {
    this.annotationTools.forEach(([g, tool], index) => {
      const item = this.viewer.world.getItemAt(index);
      const imageBbox = item.getBounds(true);
      this.resize(g, item, new OpenSeadragon.Point(imageBbox.x, imageBbox.y));
    });
  }
  

  resize(g, item, viewportStartPoint) {
    const flipped = this.viewer.viewport.getFlip();

    const p = this.viewer.viewport.pixelFromPoint(viewportStartPoint, true);
    if (flipped)
      p.x = this.viewer.viewport._containerInnerSize.x - p.x;

    const scaleY = this.currentScale(item);
    const scaleX = flipped ? - scaleY : scaleY;
    const rotation = this.viewer.viewport.getRotation();

    g.setAttribute('transform', `translate(${p.x}, ${p.y}) scale(${scaleX}, ${scaleY}) rotate(${rotation})`);

    this.scaleFormatterElements();

    if (this.selectedShape) {
      if (this.selectedShape.element) { // Editable shape
        this.selectedShape.scaleHandles(1 / scaleY);
        this.emit('viewportChange', this.selectedShape.element);
      } else {
        this.emit('viewportChange', this.selectedShape); 
      }       
    }
  }
  
  // ToDo: There needs to be an intellegent way
  // to do this because scale factors are different
  // in collectionMode.
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
    // Don't re-select
    if (this.selectedShape?.annotation === shape?.annotation)
      return;

    // If another shape is currently selected, deselect first
    if (this.selectedShape && this.selectedShape.annotation !== shape.annotation)
      this.deselect(true);

    const { annotation } = shape;

    const readOnly = this.readOnly || annotation.readOnly;

    if (!(readOnly || this.headless)) {
      setTimeout(() => shape.parentNode.removeChild(shape), 1);
      const currentTool = this._getLayerByAnnotationTarget(annotation)[1];
      const toolForAnnotation = currentTool.forAnnotation(annotation);
      this.selectedShape = toolForAnnotation.createEditableShape(annotation);
      this.selectedShape.scaleHandles(1 / this.currentScale());

      this.scaleFormatterElements(this.selectedShape.element);

      this.selectedShape.element.annotation = annotation;        

      // Disable normal OSD nav
      const editableShapeMouseTracker = new OpenSeadragon.MouseTracker({
        element: this.svg
      }).setTracking(true);

      // En-/disable OSD nav based on hover status
      this.selectedShape.element.addEventListener('mouseenter', evt =>
        editableShapeMouseTracker.setTracking(true));
  
      this.selectedShape.element.addEventListener('mouseleave', evt =>
        editableShapeMouseTracker.setTracking(false));
      
      this.selectedShape.mouseTracker = editableShapeMouseTracker;
  
      this.selectedShape.on('update', fragment =>
        this.emit('updateTarget', this.selectedShape.element, fragment));

      if (!skipEvent)
        this.emit('select', { annotation, element: this.selectedShape.element });
    } else {
      this.selectedShape = shape;

      if (!skipEvent)
        this.emit('select', { annotation, element: shape, skipEvent });   
    }
  }

  setDrawingEnabled = enable =>
    this.mouseTracker?.setTracking(enable && !this.readOnly);

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

}