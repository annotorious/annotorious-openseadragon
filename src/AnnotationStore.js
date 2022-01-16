import RBush from 'rbush';
import { SVG_NAMESPACE } from '@recogito/annotorious/src/util/SVG';
import { drawShape, shapeArea, svgFragmentToShape } from '@recogito/annotorious/src/selectors';
import { WebAnnotation } from '@recogito/recogito-client-core';
import { 
  pointInCircle,
  pointInEllipse,
  pointInPolygon
} from '@recogito/annotorious/src/util/Geom2D';

/** 
 * Computes the bounding box of an annotation. WARNING:
 * this is an expensive operation which parses the annotation,
 * creates a temporary SVG element and attaches it to the DOM,
 * uses .getBBox() and then removes the temporary SVG element.  
 */
 const getBounds = (annotation, image) => {
  const shape = drawShape(annotation, image);
  
  // A temporary SVG buffer, so we can use .getBBox()
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.style.position = 'absolute';
  svg.style.opacity = 0;
  svg.style.top = 0;
  svg.style.left = 0;

  svg.appendChild(shape);
  document.body.appendChild(svg);
  
  const { x, y, width, height } = shape.getBBox();  

  document.body.removeChild(svg);

  return {
    minX: x, 
    minY: y,
    maxX: x + width,
    maxY: y + height
  };
}

const getSelectorType = annotation => {
  const firstTarget = annotation.targets[0];

  return Array.isArray(firstTarget.selector) ? 
    firstTarget.selector[0].type : firstTarget.selector?.type;
}

/**
 * Checks if a point is inside the annotation shape. 
 * WARNING: this is only for internal use ONLY. It pre-assumes
 * an annotation with an SVGSelector (not a FragmentSelector)!
 * @param {number} x point x coordinate 
 * @param {number} y point y coordinate 
 * @param {WebAnnotation} annotation annotation (with an SVG Selector!) 
 */
const pointInSVGShape = (x, y, annotation) => {
  const svg = svgFragmentToShape(annotation);
  const nodeName = svg.nodeName.toLowerCase();

  const pt = [x, y];

  if (nodeName === 'polygon') {
    const points = Array.from(svg.points).map(pt => [pt.x, pt.y]);
    
    return pointInPolygon(pt, points);
  } else if (nodeName === 'circle') {
    const cx = svg.getAttribute('cx');
    const cy = svg.getAttribute('cy');
    const r = svg.getAttribute('r');

    return pointInCircle(pt, cx, cy, r);
  } else if (nodeName === 'ellipse') {
    const cx = svg.getAttribute('cx');
    const cy = svg.getAttribute('cy');
    const rx = svg.getAttribute('rx');
    const ry = svg.getAttribute('ry');

    return pointInEllipse(pt, cx, cy, rx, ry);
  // } else if (nodeName === 'path') {
    //
  } else {
    throw `Unsupported SVG shape type: ${nodeName}`;
  }
}

export default class AnnotationStore {

  constructor(env) {
    this.env = env;
    
    this.spatial_index = new RBush();
  }

  getAnnotationAt = (x, y, scale) => {
    // 5 pixel buffer, so we reliably catch point 
    // annotations (optionally with scale applied)
    const buffer = scale ? 5 / scale : 5;

    // Fast hit test in index (bounds only!)
    const idxHits = this.spatial_index.search({
      minX: x - buffer,
      minY: y - buffer,
      maxX: x + buffer,
      maxY: y + buffer
    }).map(item => item.annotation);

    // Exact hit test on shape (needed for SVG fragments only!)
    const exactHits = idxHits.filter(annotation => {
      const selectorType = getSelectorType(annotation);
      if (selectorType === 'FragmentSelector') {
        return true; // For FragmentSelectors, shape is always equal to bounds! 
      } else if (selectorType === 'SvgSelector') {
        return pointInSVGShape(x, y, annotation);
      } else {
        throw `Unsupported selector type: ${selectorType}`;
      }
    });

    // Get smallest annotation
    if (exactHits.length > 0) {
      exactHits.sort((a, b) => shapeArea(a, this.env.image) - shapeArea(b, this.env.image));
      return exactHits[0];
    }
  }

  getAnnotationsIntersecting = bounds =>
    this.spatial_index.search(bounds).map(item => item.annotation);

  insert = arg => {
    const annotations = Array.isArray(arg) ? arg : [ arg ];
    annotations.forEach(annotation => {
      this.spatial_index.insert({
        ...getBounds(annotation, this.env.image), annotation
      })
    });
  }

  remove = annotation => {
    // Unfortunately, .remove currently requires bounds,
    // therefore we need to re-compute. See:
    // https://github.com/mourner/rbush/issues/95
    const item = {
      ...getBounds(annotation, this.env.image),
      annotation
    };

    this.spatial_index.remove(item, (a, b) =>
      a.annotation.id === b.annotation.id);
  }

}