import EventEmitter from 'tiny-emitter';
import { SVG_NAMESPACE } from '../SVGConst';
import { RubberbandRectSelector, drawRect } from '@recogito/annotorious';

export default class OSDAnnotationLayer extends EventEmitter {

  constructor(viewer) {
    super();

    this.svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    this.svg.classList.add('a9s-annotationlayer', 'a9s-osd-annotationlayer');

    this.g = document.createElementNS(SVG_NAMESPACE, 'g');
    this.svg.appendChild(this.g);

    viewer.canvas.appendChild(this.svg);

    viewer.addHandler('animation', () => this.resize());
    viewer.addHandler('open', () => this.resize());
    viewer.addHandler('rotate', () => this.resize());
    viewer.addHandler('resize', () => this.resize());

    this.viewer = viewer;

    this.selectedShape = null;

    const selector = new RubberbandRectSelector(this.g);
    selector.on('complete', this.selectShape);
    selector.on('cancel', () => console.log('cancel'));

    if (!this.readOnly)
      this._initDrawingMouseTracker();

    this.currentTool = selector;

    this.resize();
  }

  /** Initializes the OSD MouseTracker used for drawing **/
  _initDrawingMouseTracker = () => {
    let drawing = false;

    this.mouseTracker = new OpenSeadragon.MouseTracker({
      element: this.svg,

      // Keypress starts drawing
      pressHandler:  evt => {
        drawing = true;
        this.currentTool.startDrawing(evt.originalEvent);
      },

      // Move updates the tool (if drawing)
      moveHandler: evt => {
        if (drawing)
          this.currentTool.onMouseMove(evt.originalEvent);
      },

      // Stops drawing
      releaseHandler: evt => {
        drawing = false;
        this.currentTool.onMouseUp(evt.originalEvent);
        this.mouseTracker.setTracking(false);
      }
    }).setTracking(false);

    // Keep tracker disabled until Shift is held
    document.addEventListener('keydown', evt => {
      if (evt.which === 16) // Shift
        this.mouseTracker.setTracking(true);
    });

    document.addEventListener('keyup', evt => {
      if (evt.which === 16 && !drawing)
        this.mouseTracker.setTracking(false);
    });
  }

  startDrawing = evt => {
    this.currentTool.startDrawing(evt);
  }

  addAnnotation = annotation => {
    const shape = drawRect(annotation);
    shape.setAttribute('class', 'a9s-annotation');
    shape.setAttribute('data-id', annotation.id);
    shape.annotation = annotation;

    new OpenSeadragon.MouseTracker({
      element: shape,
      clickHandler: () => this.selectShape(shape)
    }).setTracking(true);

    this.g.appendChild(shape);
  }

  findShape = annotationOrId => {
    const id = annotationOrId.id ? annotationOrId.id : annotationOrId;
    return this.g.querySelector(`.a9s-annotation[data-id="${id}"]`);
  }

  selectShape = shape => {
    const { annotation } = shape;
    const bounds = shape.getBoundingClientRect();

    this.selectedShape = shape;

    this.emit('select', { annotation, bounds }); 
  }

  init = annotations => {
    annotations.forEach(this.addAnnotation);
  }
  
  resize() {
    // Current upper left corner
    const p = this.viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0), true);

    // Compute scale factor
    const { x, y } = this.viewer.viewport.getContainerSize();
    const containerSize = Math.max(x, y);
    const zoom = this.viewer.viewport.getZoom(true);
    const scale = zoom * containerSize / this.viewer.world.getContentFactor();

    const rotation = this.viewer.viewport.getRotation();

    this.g.setAttribute('transform', `translate(${p.x}, ${p.y}) scale(${scale}) rotate(${rotation})`);

    if (this.selectedShape)
      this.emit('moveSelection', this.selectedShape.getBoundingClientRect());
  }

  deselect = () => {
    if (this.selectedShape) {
      this.selectedShape.parentNode.removeChild(this.selectedShape);
      this.selectedShape = null;
    }
  }

  addOrUpdateAnnotation = (annotation, previous) => {
    if (previous)
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


}