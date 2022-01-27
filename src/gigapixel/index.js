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
  const { selector } = target;
  
  // Create an empty annotation wrapper so we can use the
  // standard parse functions
  const annotation = WebAnnotation.create({ target });

  if (selector.type === 'SvgSelector') {
    const shape = svgFragmentToShape(annotation);
    const nodeName = shape.nodeName.toLowerCase();

    let transformed = null;

    if (nodeName === 'polygon') {
      transformed = polygonTargetToImage(shape, extent, scale);
    } else if (nodeName === 'circle') {
      transformed = circleTargetToImage(shape, extent, scale);
    } else if (nodeName === 'ellipse') {
      transformed = ellipseTargetToImage(shape, extent, scale);
    } else if (nodeName === 'path') {
      transformed = pathTargetToImage(shape, extent, scale);
    } else {
      throw `Unsupported SVG shape type: ${nodeName}`;
    }

    // TODO refactor to avoid code duplication!
    let serialized = transformed.outerHTML || new XMLSerializer().serializeToString(transformed);
    serialized = serialized.replace(` xmlns="${SVG_NAMESPACE}"`, '');
  
    return {
      ...target,
      selector: {
        type: "SvgSelector",
        value: `<svg>${serialized}</svg>`
      }
    }
  } else if (selector.type === 'FragmentSelector') {
    const { x, y, w, h } = parseRectFragment(annotation);

    const xP = extent.x + x / scale;
    const yP = extent.y + y / scale; 
    const wP = w / scale;
    const hP = h / scale;

    return w === 0 && h === 0 ?
      // Edge case/hack - handle via point tool
      { ...toRectFragment(xP, yP, wP, hP), renderedVia: { name: 'point' } } :
      toRectFragment(xP, yP, wP, hP);
  } else {
    throw `Unsupported selector type: ${selector.type}`;
  }
}

const polygonTargetToImage = (shape, extent, scale) => {
  const points = Array.from(shape.points);

  const transformed = points.map(pt => {
    const x = extent.x + pt.x / scale;
    const y = extent.y + pt.y / scale;

    return x + ',' + y;
  }).join(' ');

  shape.setAttribute('points', transformed);
  return shape;
}

const circleTargetToImage = (shape, extent, scale) => {
  const cx = parseFloat(shape.getAttribute('cx'));
  const cy = parseFloat(shape.getAttribute('cy'));
  const r =  parseFloat(shape.getAttribute('r'));

  shape.setAttribute('cx', extent.x + cx / scale);
  shape.setAttribute('cy', extent.y + cy / scale);
  shape.setAttribute('r', r / scale);

  return shape;
}

const ellipseTargetToImage = (shape, extent, scale) => {
  const cx = parseFloat(shape.getAttribute('cx'));
  const cy = parseFloat(shape.getAttribute('cy'));
  const rx = parseFloat(shape.getAttribute('rx'));
  const ry = parseFloat(shape.getAttribute('ry'));

  shape.setAttribute('cx', extent.x + cx / scale);
  shape.setAttribute('cy', extent.y + cy / scale);
  shape.setAttribute('rx', rx / scale);
  shape.setAttribute('ry', ry / scale);

  return shape;
}

const pathTargetToImage = (shape, extent, scale) => {
  const commands = shape.getAttribute('d')
    .split(/(?=M|m|L|l|H|h|V|v|Z|z)/g)
    .map(str => str.trim());

  const transformed = commands.map(cmd => {
    const op = cmd.substring(0, 1);

    if (op.toLowerCase() === 'z') {
      return op;
    } else {
      const xy = cmd.substring(1).split(' ')
        .map(str => parseFloat(str.trim()));

      // Uppercase ops are absolute coords -> transform
      const isUppercase = op === op.toUpperCase();

      const x = isUppercase ? extent.x + xy[0] / scale : xy[0] / scale;
      const y = isUppercase ? extent.y + xy[1] / scale : xy[1] / scale;

      return op + ' ' + x + ' ' + y;
    }
  }).join(' ');

  shape.setAttribute('d', transformed);
  return shape;
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
    else if (nodeName === 'circle')
      transformed = circleAnnotationToViewport(shape, extent, scale);
    else if (nodeName === 'ellipse')
      transformed = ellipseAnnotationToViewport(shape, extent, scale);
    else if (nodeName === 'path')
      transformed = pathAnnotationToViewport(shape, extent, scale);
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

const circleAnnotationToViewport = (shape, extent, scale) => {
  const cx = shape.getAttribute('cx');
  const cy = shape.getAttribute('cy');
  const r = shape.getAttribute('r');

  shape.setAttribute('cx', scale * (cx - extent.x));
  shape.setAttribute('cy', scale * (cy - extent.y));
  shape.setAttribute('r', r * scale);

  return shape;
}

const ellipseAnnotationToViewport = (shape, extent, scale) => {
  const cx = shape.getAttribute('cx');
  const cy = shape.getAttribute('cy');
  const rx = shape.getAttribute('rx');
  const ry = shape.getAttribute('ry');

  shape.setAttribute('cx', scale * (cx - extent.x));
  shape.setAttribute('cy', scale * (cy - extent.y));
  shape.setAttribute('rx', rx * scale);
  shape.setAttribute('ry', ry * scale);

  return shape;
}

const pathAnnotationToViewport = (shape, extent, scale) => {
  const commands = shape.getAttribute('d')
    .split(/(?=M|m|L|l|H|h|V|v|Z|z)/g)
    .map(str => str.trim());

  const transformed = commands.map(cmd => {
    const op = cmd.substring(0, 1);

    if (op.toLowerCase() === 'z') {
      return op;
    } else {
      const xy = cmd.substring(1).split(' ')
        .filter(str => str) // Remove leading empty strings
        .map(str => parseFloat(str.trim()));

      // Uppercase ops are absolute coords -> transform
      const isUppercase = op === op.toUpperCase();
      const x = isUppercase ? scale * (xy[0] - extent.x) : scale * xy[0];
      const y = isUppercase ? scale * (xy[1] - extent.y) : scale * xy[1];

      return op + ' ' + x + ' ' + y;
    }
  }).join(' ');

  shape.setAttribute('d', transformed);
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

  // Update formatter element position, if any
  const formatterEl = shape.querySelector('.a9s-formatter-el');
  if (formatterEl) {
    const { x, y } = shape.querySelector('.a9s-inner').getBBox();
    formatterEl.setAttribute('x', x);
    formatterEl.setAttribute('y', y);
  }
}

const refreshRectFragment = (shape, extent, scale) => {
  const { x, y, w, h } = parseRectFragment(shape.annotation);

  const outer = shape.querySelector('.a9s-outer');
  const inner = shape.querySelector('.a9s-inner');

  const offsetX = scale * (x - extent.x);
  const offsetY = scale * (y - extent.y);

  if (w === 0 && h === 0) {
    // Edge case: rendered as a point!
    [ outer, inner ].forEach(elem => {
      elem.setAttribute('cx', offsetX);
      elem.setAttribute('cy', offsetY);
    });
  } else {
    [ outer, inner ].forEach(elem => {
      elem.setAttribute('x', offsetX);
      elem.setAttribute('y', offsetY);
      elem.setAttribute('width', w * scale);
      elem.setAttribute('height', h * scale);
    });
  }
}

const refreshSvg = (shape, extent, scale) => {
  const parsedShape = svgFragmentToShape(shape.annotation);
  const nodeName = parsedShape.nodeName.toLowerCase();

  if (nodeName === 'polygon') {
    refreshPolygon(shape, parsedShape, extent, scale);
  } else if (nodeName === 'circle') {
    refreshCircle(shape, parsedShape, extent, scale);
  } else if (nodeName === 'ellipse') {
    refreshEllipse(shape, parsedShape, extent, scale);
  } else if (nodeName === 'path') {
    refreshPath(shape, parsedShape, extent, scale);
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

const refreshCircle = (shape, imageShape, extent, scale) => {
  const cx = scale * (imageShape.getAttribute('cx') - extent.x);
  const cy = scale * (imageShape.getAttribute('cy') - extent.y);
  const r =  scale * imageShape.getAttribute('r');

  const outer = shape.querySelector('.a9s-outer');
  outer.setAttribute('cx', cx);
  outer.setAttribute('cy', cy);
  outer.setAttribute('r', r);

  const inner = shape.querySelector('.a9s-inner');
  inner.setAttribute('cx', cx);
  inner.setAttribute('cy', cy);
  inner.setAttribute('r', r);
} 

const refreshEllipse = (shape, imageShape, extent, scale) => {
  const cx = scale * (imageShape.getAttribute('cx') - extent.x);
  const cy = scale * (imageShape.getAttribute('cy') - extent.y);
  const rx = scale * imageShape.getAttribute('rx');
  const ry = scale * imageShape.getAttribute('ry');

  const outer = shape.querySelector('.a9s-outer');
  outer.setAttribute('cx', cx);
  outer.setAttribute('cy', cy);
  outer.setAttribute('rx', rx);
  outer.setAttribute('ry', ry);

  const inner = shape.querySelector('.a9s-inner');
  inner.setAttribute('cx', cx);
  inner.setAttribute('cy', cy);
  inner.setAttribute('rx', rx);
  inner.setAttribute('ry', ry);
}

const refreshPath = (shape, imageShape, extent, scale) => {
  const commands = imageShape.getAttribute('d')
    .split(/(?=M|m|L|l|H|h|V|v|Z|z)/g)
    .map(str => str.trim());

  const transformed = commands.map(cmd => {
    const op = cmd.substring(0, 1);

    if (op.toLowerCase() === 'z') {
      return op;
    } else {
      const xy = cmd.substring(1).split(' ')
        .filter(str => str) // Remove leading empty strings
        .map(str => parseFloat(str.trim()));

      // Uppercase ops are absolute coords -> transform
      const isUppercase = op === op.toUpperCase();
      const x = isUppercase ? scale * (xy[0] - extent.x) : scale * xy[0];
      const y = isUppercase ? scale * (xy[1] - extent.y) : scale * xy[1];

      return op + ' ' + x + ' ' + y;
    }
  }).join(' ');

  shape.querySelector('.a9s-inner').setAttribute('d', transformed);
  shape.querySelector('.a9s-outer').setAttribute('d', transformed);
}