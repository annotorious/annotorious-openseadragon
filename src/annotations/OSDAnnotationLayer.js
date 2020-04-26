import EventEmitter from 'tiny-emitter';
import { SVG_NAMESPACE } from '../SVGConst';

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

    this.resize();
  }

  addAnnotation = annotation => {
    // TODO parse annotation
    const shape = document.createElementNS(SVG_NAMESPACE, 'rect');
    shape.setAttribute('x',0.1);
    shape.setAttribute('y',0.1);
    shape.setAttribute('width',0.3);
    shape.setAttribute('height',0.1);
    shape.setAttribute('class', 'a9s-annotation');
    shape.setAttribute('data-id', annotation.id);
    shape.annotation = annotation;
  
    this.g.appendChild(shape);
  }

  init = annotations =>
    annotations.forEach(this.addAnnotation);
  
  resize() {
    const p = this.viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0), true);
    const zoom = this.viewer.viewport.getZoom(true);
    const rotation = this.viewer.viewport.getRotation();

    var scale = this.viewer.viewport._containerInnerSize.x * zoom;

    this.g.setAttribute('transform',
     `translate(${p.x},${p.y}) scale(${scale}) rotate(${rotation})`);

    // this.emit('updateBounds', this.g.querySelector('rect').getBoundingClientRect());
  }

}