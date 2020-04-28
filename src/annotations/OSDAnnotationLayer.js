import EventEmitter from 'tiny-emitter';
import { SVG_NAMESPACE } from '../SVGConst';
import { drawRect } from '@recogito/annotorious';

import './OSDAnnotationLayer.scss';

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

    this.resize();
  }

  addAnnotation = annotation => {
    const shape = drawRect(annotation);
    shape.setAttribute('class', 'a9s-annotation');
    shape.setAttribute('data-id', annotation.id);
    shape.annotation = annotation;

    new OpenSeadragon.MouseTracker({
      element: shape,
      clickHandler: () => {
        const bounds = shape.getBoundingClientRect();
        this.selectedShape = shape;
        this.emit('select', { annotation, bounds }); 
        return null;
      }
  }).setTracking(true);

  
    this.g.appendChild(shape);
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
      this.emit('updateBounds', this.selectedShape.getBoundingClientRect());
  }

}