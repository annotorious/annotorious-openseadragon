import EventEmitter from 'tiny-emitter';
import OpenSeadragon from 'openseadragon';
import { SVG_NAMESPACE } from './SVGConst';
import { DrawingTools, drawShape, format, parseRectFragment } from '@recogito/annotorious/src';

export default class OSDAnnotationLayer extends EventEmitter {

  constructor(props) {
    super();

    this.viewer = props.viewer;

    this.readOnly = props.readOnly;
    this.formatter = props.config?.formatter;

    this.svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    this.svg.setAttribute('class', 'a9s-annotationlayer', 'a9s-osd-annotationlayer');

    this.g = document.createElementNS(SVG_NAMESPACE, 'g');
    this.svg.appendChild(this.g);

    this.viewer.canvas.appendChild(this.svg);

    this.viewer.addHandler('animation', () => this.resize());
    this.viewer.addHandler('rotate', () => this.resize());
    this.viewer.addHandler('resize', () => this.resize());

    this.viewer.addHandler('open', () => { 
      // Store image properties to environment
      const { x, y } = this.viewer.world.getItemAt(0).source.dimensions;
      
      props.env.image = {
        src: this.viewer.world.getItemAt(0).source['@id'],
        naturalWidth: x,
        naturalHeight: y
      };

      this.resize();
    });

    this.selectedShape = null;

    if (!this.readOnly) {
      this.tools = new DrawingTools(this.g, props.config, props.env);
      this._initDrawingMouseTracker();
    }
  }

  /** Initializes the OSD MouseTracker used for drawing **/
  _initDrawingMouseTracker = () => {
    this.mouseTracker = new OpenSeadragon.MouseTracker({
      element: this.svg,

      pressHandler:  evt =>
        this.tools.current.startDrawing(evt.originalEvent),

      moveHandler: evt => {
        if (this.tools.current.isDrawing)
          this.tools.current.onMouseMove(evt.originalEvent);
      },

      releaseHandler: evt =>
        this.tools.current.onMouseUp(evt.originalEvent)
    }).setTracking(false);

    this.tools.on('complete', shape => { 
      this.emit('createSelection', shape.annotation);
      this.mouseTracker.setTracking(false);
      this.selectShape(shape);
    });

    // Keep tracker disabled until Shift is held
    document.addEventListener('keydown', evt => {
      if (evt.which === 16 && !this.selectedShape) // Shift
        this.mouseTracker.setTracking(true);
    });

    document.addEventListener('keyup', evt => {
      if (evt.which === 16 && !this.tools.current.isDrawing)
        this.mouseTracker.setTracking(false);
    });
  }

  addAnnotation = annotation => {
    const shape = drawShape(annotation);
    shape.setAttribute('class', 'a9s-annotation');
    format(shape, annotation, this.formatter);

    shape.setAttribute('data-id', annotation.id);
    shape.annotation = annotation;

    shape.addEventListener('mouseenter', evt => {
      if (!this.tools?.current.isDrawing)
        this.emit('mouseEnterAnnotation', annotation, evt);
    });

    shape.addEventListener('mouseleave', evt => {
      if (!this.tools?.current.isDrawing)
        this.emit('mouseLeaveAnnotation', annotation, evt);
    });

    shape.mouseTracker = new OpenSeadragon.MouseTracker({
      element: shape,
      clickHandler: () => this.selectShape(shape)
    }).setTracking(true);

    this.g.appendChild(shape);
  }

  addOrUpdateAnnotation = (annotation, previous) => {
    if (this.selectedShape?.annotation === annotation || this.selectShape?.annotation == previous)
      this.deselect();
  
    if (previous)
      this.removeAnnotation(annotation);

    this.removeAnnotation(annotation);
    this.addAnnotation(annotation);
  }

  currentScale = () => {
    const { x, y } = this.viewer.viewport.getContainerSize();
    const containerSize = Math.max(x, y);
    const zoom = this.viewer.viewport.getZoom(true);
    return zoom * containerSize / this.viewer.world.getContentFactor();
  }

  deselect = () => {
    if (this.selectedShape) {
      const { annotation } = this.selectedShape;

      if (annotation.isSelection)
        this.tools.current.stop();

      if (this.selectedShape.destroy) {
        // Modifiable shape: destroy and re-add the annotation
        this.selectedShape.mouseTracker.destroy();
        this.selectedShape.destroy();

        if (!annotation.isSelection)
          this.addAnnotation(annotation);
      }
      
      this.selectedShape = null;
    }
  }

  destroy = () => {
    this.selectedShape = null;
    this.mouseTracker.destroy();
    this.svg.parentNode.removeChild(this.svg);
  }

  findShape = annotationOrId => {
    const id = annotationOrId?.id ? annotationOrId.id : annotationOrId;
    return this.g.querySelector(`.a9s-annotation[data-id="${id}"]`);
  }

  fitBounds = (annotationOrId, immediately) => {
    const shape = this.findShape(annotationOrId);
    if (shape) {
      const { x, y, w, h } = parseRectFragment(shape.annotation);      
      const rect = this.viewer.viewport.imageToViewportRectangle(x, y, w, h);
      
      this.viewer.viewport.fitBounds(rect, immediately);
    }    
  }

  getAnnotations = () => {
    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation'));
    return shapes.map(s => s.annotation);
  }

  init = annotations => {
    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation'));
    shapes.forEach(s => this.g.removeChild(s));
    annotations.forEach(this.addAnnotation);
  }

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
  
  removeAnnotation = annotation => {
    if (this.selectedShape?.annotation === annotation)
      this.deselect();

    const shape = this.findShape(annotation);
    if (shape) {
      shape.mouseTracker.destroy();
      shape.parentNode.removeChild(shape);
    }
  }

  resize() {
    const p = this.viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0), true);
    const scale = this.currentScale();
    const rotation = this.viewer.viewport.getRotation();

    this.g.setAttribute('transform', `translate(${p.x}, ${p.y}) scale(${scale}) rotate(${rotation})`);

    if (this.selectedShape) {
      if (this.selectedShape.element) { // Editable shape
        this.selectedShape.scaleHandles(1 / scale);
        this.emit('moveSelection', this.selectedShape.element);
      } else {
        this.emit('moveSelection', this.selectedShape); 
      }       
    }
  }
  
  selectAnnotation = annotationOrId => {
    if (this.selectedShape)
      this.deselect();

    const selected = this.findShape(annotationOrId);

    // Select with 'skipEvent' flag
    if (selected)
      this.selectShape(selected, true);
    else
      this.deselect();

    return selected?.annotation;
  }

  selectShape = (shape, skipEvent) => {
    // Don't re-select
    if (this.selectedShape?.annotation === shape?.annotation)
      return;

    // If another shape is currently selected, deselect first
    if (this.selectedShape && this.selectedShape.annotation !== shape.annotation)
      this.deselect();

    const { annotation } = shape;

    const readOnly = this.readOnly || annotation.readOnly;

    if (!(readOnly || this.headless)) {
      const toolForShape = this.tools.forShape(shape);
      
      if (toolForShape?.supportsModify) {
        // Replace the shape with an editable version
        shape.parentNode.removeChild(shape);  

        this.selectedShape = toolForShape.createEditableShape(annotation);
        this.selectedShape.scaleHandles(1 / this.currentScale());

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

        this.emit('select', { annotation, element: this.selectedShape.element, skipEvent });
      } else {
        this.selectedShape = shape;
        this.emit('select', { annotation, element: shape, skipEvent });     
      }
    } else {
      this.selectedShape = shape;
      this.emit('select', { annotation, element: shape, skipEvent });   
    }
  }

  setDrawingEnabled = enable =>
    this.mouseTracker.setTracking(enable);

  setDrawingTool = shape =>
    this.tools.setCurrent(shape);

}