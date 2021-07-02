import { parseRectFragment, svgFragmentToShape } from "@recogito/annotorious/src/selectors";

export const renderPrecise = (shape, extent, scale) => {
  const firstTarget = shape.annotation.targets[0];

  if (firstTarget) {
    const firstSelector = Array.isArray(firstTarget.selector) ? firstTarget.selector[0] : firstTarget.selector;

    if (firstSelector.type === 'FragmentSelector')
      renderRectFragment(shape, extent, scale);
    else if (firstSelector.type === 'SvgSelector') 
      renderSvg(shape, extent, scale);
    else
      throw `Unsupported selector type type: ${firstSelector.type}`;
  }
}

const renderRectFragment = (shape, extent, scale) => {
  const { x, y, w, h } = parseRectFragment(shape.annotation);

  const outer = shape.querySelector('.a9s-outer');
  const inner = shape.querySelector('.a9s-inner');

  const offsetX = scale * (x - extent.x);
  const offsetY = scale * (y - extent.y);

  outer.setAttribute('x', offsetX);
  outer.setAttribute('y', offsetY);
  outer.setAttribute('width', w * scale);
  outer.setAttribute('height', h * scale);

  inner.setAttribute('x', offsetX);
  inner.setAttribute('y', offsetY);
  inner.setAttribute('width', w * scale);
  inner.setAttribute('height', h * scale);
} 

const renderSvg = (shape, extent, scale) => {
  const parsedShape = svgFragmentToShape(shape.annotation);
  const nodeName = parsedShape.nodeName.toLowerCase();

  if (nodeName === 'polygon') {
    renderPolygon(shape, parsedShape, extent, scale);
  } else {
    throw `Unsupported SVG shape type: ${nodeName}`;
  }
}

const renderPolygon = (screenShape, annotationShape, extent, scale) => {
  const points = annotationShape.getAttribute('points')
    .split(' ') // Split x/y tuples
    .map(xy => xy.split(',').map(str => parseFloat(str.trim())));

  const screenPoints = points.map(pt =>
      `${scale * (pt[0] - extent.x)},${scale * (pt[1] - extent.y)}`
    ).join(' ');

  const outer = screenShape.querySelector('.a9s-outer');
  const inner = screenShape.querySelector('.a9s-inner');

  outer.setAttribute('points', screenPoints);
  inner.setAttribute('points', screenPoints);
}