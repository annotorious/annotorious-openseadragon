import { WebAnnotation } from '@recogito/recogito-client-core';
import { toRectFragment, parseRectFragment } from '@recogito/annotorious/src/selectors';

const currentTransform = viewer => {
  const extent = viewer.viewport.viewportToImageRectangle(viewer.viewport.getBounds(true));
  
  const containerWidth = viewer.viewport.getContainerSize().x;
  const zoom = viewer.viewport.getZoom(true);
  const scale = zoom * containerWidth / viewer.world.getContentFactor();

  return { extent, scale };
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

  if (fragmentSelector) {
    const { x, y, w, h } = parseRectFragment(annotation);

    const updatedX = (x - extent.x) * scale;
    const updatedY = (y - extent.y) * scale;

    const target = toRectFragment(
      updatedX, updatedY, 
      w * scale, h * scale
    );

    return annotation.clone({ target });
  } else if (svgSelector) {
    const shape = svgFragmentToShape(annotation);

  }
}

/**
 * Updates the position of the shape to match the current viewport
 * transform.
 */
export const refreshViewportPosition = (viewer, shape) => {
  const { extent, scale } = currentTransform(viewer);

  const firstTarget = shape.annotation.targets[0];

  if (firstTarget) {
    const firstSelector = Array.isArray(firstTarget.selector) ? firstTarget.selector[0] : firstTarget.selector;

    if (firstSelector.type === 'FragmentSelector')
      refreshRectFragment(shape, extent, scale);
    else if (firstSelector.type === 'SvgSelector') 
      refreshSvg(shape, extent, scale);
    else
      throw `Unsupported selector type type: ${firstSelector.type}`;
  }
}

const refreshRectFragment = (shape, extent, scale) => {
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

const refreshSvg = (shape, extent, scale) => {
  const parsedShape = svgFragmentToShape(shape.annotation);
  const nodeName = parsedShape.nodeName.toLowerCase();

  if (nodeName === 'polygon') {
    renderPolygon(shape, parsedShape, extent, scale);
  } else {
    throw `Unsupported SVG shape type: ${nodeName}`;
  }
}