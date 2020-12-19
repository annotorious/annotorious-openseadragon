import EventEmitter from 'tiny-emitter';
import OpenSeadragon from 'openseadragon';
import { SVG_NAMESPACE } from '../SVGConst';
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

    this.resize();
  }

  /** Initializes the OSD MouseTracker used for drawing **/
  _initDrawingMouseTracker = () => {
    this.tools.on('complete', shape => { 
      this.emit('createSelection', shape.annotation);
      this.mouseTracker.setTracking(false);
      this.selectShape(shape);
    });

    this.mouseTracker = new OpenSeadragon.MouseTracker({
      element: this.svg,

      // Keypress starts drawing
      pressHandler:  evt => {
        this.tools.current.startDrawing(evt.originalEvent);
      },

      // Move updates the tool (if drawing)
      moveHandler: evt => {
        if (this.tools.current.isDrawing)
          this.tools.current.onMouseMove(evt.originalEvent);
      },

      // Stops drawing
      releaseHandler: evt => {     
        this.tools.current.onMouseUp(evt.originalEvent);
      }
    }).setTracking(false);

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
      if (!this.tools.current.isDrawing)
        this.emit('mouseEnterAnnotation', annotation, evt);
    });

    shape.addEventListener('mouseleave', evt => {
      if (!this.tools.current.isDrawing)
        this.emit('mouseLeaveAnnotation', annotation, evt);
    });

    new OpenSeadragon.MouseTracker({
      element: shape,
      clickHandler: () => this.selectShape(shape)
    }).setTracking(true);

    this.g.appendChild(shape);
  }

  findShape = annotationOrId => {
    const id = annotationOrId?.id ? annotationOrId.id : annotationOrId;
    return this.g.querySelector(`.a9s-annotation[data-id="${id}"]`);
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

        // Yikes... hack to make the tool act like SVG annotation shapes - needs redesign
        this.selectedShape.element.annotation = annotation;         
        //this.attachHoverListener(this.selectedShape.element, annotation);
        
        // Hack: disable normal OSD nav
        // TODO en-/disable based on hover status
        this.mouseTracker = new OpenSeadragon.MouseTracker({
          element: this.svg
        }).setTracking(true);
    
        this.selectedShape.on('update', fragment => {
          this.emit('updateTarget', this.selectedShape.element, fragment);
        });

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

  init = annotations => {
    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation'));
    shapes.forEach(s => this.g.removeChild(s));
    annotations.forEach(this.addAnnotation);
  }

  // Helper to compute current scale factor
  currentScale = () => {
    const { x, y } = this.viewer.viewport.getContainerSize();
    const containerSize = Math.max(x, y);
    const zoom = this.viewer.viewport.getZoom(true);
    return zoom * containerSize / this.viewer.world.getContentFactor();
  }
  
  resize() {
    // Current upper left corner
    const p = this.viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0), true);
    const scale = this.currentScale();
    const rotation = this.viewer.viewport.getRotation();

    this.g.setAttribute('transform', `translate(${p.x}, ${p.y}) scale(${scale}) rotate(${rotation})`);

    if (this.selectedShape) {
      this.selectedShape.scaleHandles(1 / scale);
       
      // TODO HACK!!
      const shape = this.selectedShape.element || this.selectedShape;
      this.emit('moveSelection', shape);
    }
  }

  deselect = () => {
    if (this.selectedShape) {
      const { annotation } = this.selectedShape;

      if (annotation.isSelection)
        this.tools.current.stop();

      if (this.selectedShape.destroy) {
        // Modifiable shape: destroy and re-add the annotation
        this.selectedShape.destroy();
        this.mouseTracker.destroy();

        if (!annotation.isSelection)
          this.addAnnotation(annotation);
      }
      
      this.selectedShape = null;
    }
  }

  addOrUpdateAnnotation = (annotation, previous) => {
    if (this.selectedShape?.annotation === annotation || this.selectShape?.annotation == previous)
      this.deselect();
  
    if (previous)
      this.removeAnnotation(annotation);

    this.removeAnnotation(annotation);
    this.addAnnotation(annotation);
  }

  removeAnnotation = annotation => {
    if (this.selectedShape?.annotation === annotation)
      this.deselect();

    const shape = this.findShape(annotation);
    if (shape)
      shape.parentNode.removeChild(shape);
  }

  selectAnnotation = annotationOrId => {
    // Deselect first
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

  fitBounds = (annotationOrId, immediately) => {
    const shape = this.findShape(annotationOrId);
    if (shape) {
      const { x, y, w, h } = parseRectFragment(shape.annotation);      
      const rect = this.viewer.viewport.imageToViewportRectangle(x, y, w, h);
      
      this.viewer.viewport.fitBounds(rect, immediately);
    }    
  }

  setDrawingEnabled = enable =>
    this.mouseTracker.setTracking(enable);

  setDrawingTool = shape =>
    this.tools.setCurrent(shape);

  getAnnotations = () => {
    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation'));
    return shapes.map(s => s.annotation);
  }

  destroy = () => {
    this.selectedShape = null;
    this.svg.parentNode.removeChild(this.svg);
  }

  /** 
   * Forces a new ID on the annotation with the given ID. 
   * @returns the updated annotation for convenience
   */
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

}