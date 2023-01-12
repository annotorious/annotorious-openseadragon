import { SVG_NAMESPACE } from '@recogito/annotorious/src/util/SVG';

export default class Crosshair {

  constructor(svgEl) {
    const container = document.createElementNS(SVG_NAMESPACE, 'svg');
    container.setAttribute('class', 'a9s-osd-crosshair-container');

    const g = document.createElementNS(SVG_NAMESPACE, 'g');
    g.setAttribute('class', 'a9s-crosshair');
    
    container.appendChild(g);

    const h = document.createElementNS(SVG_NAMESPACE, 'line');
    const v = document.createElementNS(SVG_NAMESPACE, 'line');

    g.appendChild(h);
    g.appendChild(v);

    svgEl.parentElement.appendChild(container);

    const onMove = evt => {
      const { offsetX, offsetY } = evt;

      const width = svgEl.parentElement.offsetWidth;
      const height = svgEl.parentElement.offsetHeight;

      h.setAttribute('x1', 0);
      h.setAttribute('y1', offsetY);
      h.setAttribute('x2', width);
      h.setAttribute('y2', offsetY);

      v.setAttribute('x1', offsetX);
      v.setAttribute('y1', 0);
      v.setAttribute('x2', offsetX);
      v.setAttribute('y2', height);
    };

    svgEl.addEventListener('pointermove', onMove);
    svgEl.parentElement.addEventListener('pointermove', onMove);
  }

}