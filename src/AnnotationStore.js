import RBush from 'rbush';
import { SVG_NAMESPACE } from '@recogito/annotorious/src/util/SVG';
import { drawShape, shapeArea } from '@recogito/annotorious/src/selectors';

/** 
 * Computes the bounding box of an annotation. WARNING:
 * this is an expensive operation which parses the annotation,
 * creates a temporary SVG element and attaches it to the DOM,
 * uses .getBBox() and then removes the temporary SVG element.  
 */
 export const getBounds = annotation => {
  const shape = drawShape(annotation);
  
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

export default class AnnotationStore {

  constructor(env) {
    this.env = env;
    
    this.spatial_index = new RBush();
  }

  getAnnotationAt = (x, y) => {
    const hits = this.spatial_index.search({
      minX: x,
      minY: y,
      maxX: x,
      maxY: y
    }).map(item => item.annotation);

    // Get smallest annotation
    if (hits.length > 0) {
      hits.sort((a, b) => shapeArea(a, this.env.image) - shapeArea(b, this.env.image));
      return hits[0];
    }
  }

  getAnnotationsIntersecting = bounds =>
    this.spatial_index.search(bounds).map(item => item.annotation);

  insert = arg => {
    const annotations = Array.isArray(arg) ? arg : [ arg ];
    annotations.forEach(annotation => {
      this.spatial_index.insert({
        ...getBounds(annotation), annotation
      })
    });
  }

  remove = annotation => {
    this.spatial_index.remove(({ annotation }), (a, b) =>
      a.annotation.id === b.annotation.id);
  }

}