import { WebAnnotation } from '@recogito/recogito-client-core';
import { SVG_NAMESPACE } from '@recogito/annotorious/src/util/SVG';
import { 
  parseRectFragment,
  svgFragmentToShape,
  toRectFragment, 
} from '@recogito/annotorious/src/selectors';

const currentTransform = viewer => {
  const extent = viewer.viewport.viewportToImageRectangle(viewer.viewport.getBounds(true));
  
  const containerWidth = viewer.viewport.getContainerSize().x;
  const zoom = viewer.viewport.getZoom(true);
  const scale = zoom * containerWidth / viewer.world.getContentFactor();

  return { extent, scale };
}

/**
 * 'FragmentSelector' or 'SvgSelector'
 */
const getSelectorType = annotation => {
  const firstTarget = annotation.targets[0];

  return firstTarget ? (
    Array.isArray(firstTarget.selector) ? firstTarget.selector[0].type : firstTarget.selector?.type
  ) : null;
}

/**
 * Converts an annotation target in gigapixel viewport coordinates to 
 * base image coordinates.
 */
export const viewportTargetToImage = (viewer, target) => {
  const { extent, scale } = currentTransform(viewer);

  const { x, y, w, h } = parseRectFragment(WebAnnotation.create({ target }));

  const xP = extent.x + x / scale;
  const yP = extent.y + y / scale; 
  const wP = w / scale;
  const hP = h / scale;

  return toRectFragment(xP, yP, wP, hP);
}

/**
 * Converts an annotation in base image coordinates to 
 * gigapixel viewport coordinates.
 */
export const imageAnnotationToViewport = (viewer, annotation) => {
  const { extent, scale } = currentTransform(viewer);

  const fragmentSelector = annotation.selector('FragmentSelector');
  const svgSelector = annotation.selector('SvgSelector');
  
  if (svgSelector) {
    const shape = svgFragmentToShape(annotation);
    const nodeName = shape.nodeName.toLowerCase();

    let transformed = null;

    if (nodeName === 'polygon')
      transformed = polygonAnnotationToViewport(shape, extent, scale);
    else
      throw `Unsupported SVG shape type: ${nodeName}`;

    let serialized = transformed.outerHTML || new XMLSerializer().serializeToString(transformed);
    serialized = serialized.replace(` xmlns="${SVG_NAMESPACE}"`, '');
  
    const target = {
      selector: {
        type: "SvgSelector",
        value: `<svg>${serialized}</svg>`
      }
    }

    return annotation.clone({ target });

  } else if (fragmentSelector) {
    const { x, y, w, h } = parseRectFragment(annotation);

    const updatedX = (x - extent.x) * scale;
    const updatedY = (y - extent.y) * scale;

    const target = toRectFragment(
      updatedX, updatedY, 
      w * scale, h * scale
    );

    return annotation.clone({ target });
  }
}

const polygonAnnotationToViewport = (shape, extent, scale) => {
  const points = Array.from(shape.points);

  const transformed = points.map(pt => {
    const x = scale * (pt.x - extent.x);
    const y = scale * (pt.y - extent.y);

    return x + ',' + y;
  }).join(' ');

  shape.setAttribute('points', transformed);
  return shape;
}

/**
 * Updates the position of the shape to match the current viewport
 * transform.
 */
export const refreshViewportPosition = (viewer, shape) => {
  const { extent, scale } = currentTransform(viewer);

  const selectorType = getSelectorType(shape.annotation);
  
  if (selectorType === 'FragmentSelector')
    refreshRectFragment(shape, extent, scale);
  else if (selectorType === 'SvgSelector') 
    refreshSvg(shape, extent, scale);
  else
    throw `Unsupported selector type type: ${selectorType}`;
}

const refreshRectFragment = (shape, extent, scale) => {
  const { x, y, w, h } = parseRectFragment(shape.annotation);

  const outer = shape.querySelector('.a9s-outer');
  const inner = shape.querySelector('.a9s-inner');

  const offsetX = scale * (x - extent.x);
  const offsetY = scale * (y - extent.y);

  [ outer, inner ].forEach(elem => {
    elem.setAttribute('x', offsetX);
    elem.setAttribute('y', offsetY);
    elem.setAttribute('width', w * scale);
    elem.setAttribute('height', h * scale);
  });
}

const refreshSvg = (shape, extent, scale) => {
  const parsedShape = svgFragmentToShape(shape.annotation);
  const nodeName = parsedShape.nodeName.toLowerCase();

  if (nodeName === 'polygon') {
    refreshPolygon(shape, parsedShape, extent, scale);
  } else {
    throw `Unsupported SVG shape type: ${nodeName}`;
  }
}

const refreshPolygon = (shape, imageShape, extent, scale) => {
  const points = Array.from(imageShape.points);

  const transformed = points.map(pt => {
    const x = scale * (pt.x - extent.x);
    const y = scale * (pt.y - extent.y);

    return x + ',' + y;
  }).join(' ');

  const outer = shape.querySelector('.a9s-outer');
  outer.setAttribute('points', transformed);

  const inner = shape.querySelector('.a9s-inner');
  inner.setAttribute('points', transformed);
}