import EventEmitter from 'tiny-emitter';
import { SVG_NAMESPACE } from '../SVGConst';
import { parseRectFragment } from '@recogito/annotorious';

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
    const { x, y, w, h } = parseRectFragment(annotation);

    const shape = document.createElementNS(SVG_NAMESPACE, 'rect');
    shape.setAttribute('x', x);
    shape.setAttribute('y', y);
    shape.setAttribute('width', w);
    shape.setAttribute('height', h);
    shape.setAttribute('class', 'a9s-annotation');
    shape.setAttribute('data-id', annotation.id);
    shape.annotation = annotation;

    shape.addEventListener('click', () => {
      const bounds = shape.getBoundingClientRect();
      this.selectedShape = shape;
      this.emit('select', { annotation, bounds }); 
    });
  
    this.g.appendChild(shape);
  }

  init = annotations => {
    annotations.forEach(this.addAnnotation);
  }
  
  resize() {
    const p = this.viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0), true);
    const rotation = this.viewer.viewport.getRotation();
    const zoom = this.viewer.viewport.getZoom(true);
    this.g.setAttribute('transform', `translate(${p.x}, ${p.y}) scale(${zoom}) rotate(${rotation})`);

    if (this.selectedShape)
      this.emit('updateBounds', this.selectedShape.getBoundingClientRect());
  }

}