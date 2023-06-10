import OpenSeadragon from 'openseadragon';
import { drawShape } from '@recogito/annotorious/src/selectors';
import { format } from '@recogito/annotorious/src/util/Formatting';
import { addClass, removeClass } from '@recogito/annotorious/src/util/SVG';
import { isTouchDevice } from '@recogito/annotorious/src/util/Touch';
import { viewportTargetToImage, imageAnnotationToViewport, refreshViewportPosition } from '.';
import { AnnotationLayer } from '../OSDAnnotationLayer';

const isTouch = isTouchDevice();

export default class GigapixelAnnotationLayer extends AnnotationLayer {

  constructor(props) {
    super(props);
    this._initDrawingTools(true);
  }

  // Common code for fitBounds and fitBoundsWithConstraints
  _fit = (annotationOrId, opts, fn) => {
    const immediately = opts ? (
      typeof opts == 'boolean' ? opts : opts.immediately
    ) : false; 

    const padding = opts?.padding || 0;

    const shape = this.findShape(annotationOrId);
    if (shape) {
      const containerBounds = this.viewer.container.getBoundingClientRect();
      const shapeBounds = shape.getBoundingClientRect();

      const x = shapeBounds.x - containerBounds.x;
      const y = shapeBounds.y - containerBounds.y;
      const { width, height } = shapeBounds;

      const padX = x - padding;
      const padY = y - padding;
      const padW = width + 2 * padding;
      const padH = height + 2 * padding;

      const rect = this.viewer.viewport.viewerElementToViewportRectangle(new OpenSeadragon.Rect(padX, padY, padW, padH)); 
      
      this.viewer.viewport[fn](rect, immediately);
    }    
  }

  _getShapeAt = evt => {
    const getXY = evt => {
      if (isTouch) {
        const bbox = this.svg.getBoundingClientRect();
  
        const x = evt.clientX - bbox.x;
        const y = evt.clientY - bbox.y;
        
        return new OpenSeadragon.Point(x, y);
      } else {
        return new OpenSeadragon.Point(evt.offsetX, evt.offsetY);
      }
    }

    // For some reason, this doesn't seem to work in one step...
    const pt = this.viewer.viewport.viewerElementToViewportCoordinates(getXY(evt));
    const { x, y } = this.viewer.viewport.viewportToImageCoordinates(pt.x, pt.y);

    const annotation = this.store.getAnnotationAt(x, y, this.currentScale());
    if (annotation)
      return this.findShape(annotation);
  }

  _refreshNonScalingAnnotations = () => {
    // No scaling needed in gigapixel mode!
  }

  addAnnotation = (annotation, optBuffer) => {
    const g = optBuffer || this.g;

    const shape = drawShape(annotation, this.env.image);
    addClass(shape, 'a9s-annotation');

    shape.setAttribute('data-id', annotation.id);
    shape.annotation = annotation;

    refreshViewportPosition(this.viewer, shape);

    g.appendChild(shape);

    format(shape, annotation, this.formatters);

    return shape;
  }

  /**
   * Differs from non-gigapixel implementation only onsofar as 
   * non-scaling shapes need no scaling!
   */
  addOrUpdateAnnotation = (annotation, previous) => {
    const selected = this.selectedShape?.annotation;
    if (selected === annotation || selected?.isSelection || selected == previous)
      this.deselect();
  
    if (previous)
      this.removeAnnotation(annotation);

    this.removeAnnotation(annotation);

    this.addAnnotation(annotation);
    this.store.insert(annotation);
  }

  /** Same: no counter-scaling for non-scaling shapes needed **/
  deselect = () => {
    this.tools?.current.stop();
    
    if (this.selectedShape) {
      const { annotation } = this.selectedShape;

      if (this.selectedShape.destroy) {
        // Modifiable shape: destroy and re-add the annotation
        this.selectedShape.mouseTracker.destroy();
        this.selectedShape.destroy();

        if (!annotation.isSelection)
          this.addAnnotation(annotation);
      } else {
        // Non-editable shape or read-only
        removeClass(this.selectedShape, 'selected');
      }
      
      this.selectedShape = null;
    }
  }

  onDrawingComplete = shape => {
    // Annotation is in SVG coordinates - project to image coordinates  
    const reprojected = shape.annotation.clone({ target: viewportTargetToImage(this.viewer, shape.annotation.target) });
    shape.annotation = reprojected;

    this.selectShape(shape);
    this.emit('createSelection', shape.annotation);

    this.mouseTracker.enabled = false;
  }

  resize() {
    if (!this.store)
      return;

    // Update positions for all annotations except selected (will be handled separately)
    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation:not(.selected)'));
    shapes.forEach(s =>
      refreshViewportPosition(this.viewer, s));
    
    if (this.selectedShape) {
      if (this.selectedShape.element) {
        // Update the viewport position of the editable shape by transforming
        // this.selectedShape.element.annotation -> this always holds the current
        // position in image coordinates (including after drag/resize)
        const projected = imageAnnotationToViewport(this.viewer, this.selectedShape.element.annotation);
        
        this.selectedShape.updateState && this.selectedShape.updateState(projected);
        
        this.emit('viewportChange', this.selectedShape.element);
      } else {
        this.emit('viewportChange', this.selectedShape); 
      }       
    }
  }

  selectShape = (shape, skipEvent) => {
    if (!skipEvent && !shape.annotation.isSelection)
      this.emit('clickAnnotation', shape.annotation, shape);
  
    // Don't re-select
    if (this.selectedShape?.annotation === shape.annotation)
      return;

    // If another shape is currently selected, deselect first
    if (this.selectedShape && this.selectedShape.annotation !== shape.annotation)
      this.deselect(true);

    const { annotation } = shape;

    const readOnly = this.readOnly || annotation.readOnly;

    if (!(readOnly || this.headless)) {
      setTimeout(() => {
        shape.parentNode.removeChild(shape);

        // Fire the event AFTER the original shape was removed. Otherwise,
        // people calling `.getAnnotations()` in the `onSelectAnnotation` 
        // handler will receive a duplicate annotation
        // (See issue https://github.com/recogito/annotorious-openseadragon/issues/63)
        if (!skipEvent)
          this.emit('select', { annotation, element: this.selectedShape.element });
      }, 1);

      // Init the EditableShape (with the original annotation in image coordinates)
      const toolForAnnotation = this.tools.forAnnotation(annotation);
      this.selectedShape = toolForAnnotation.createEditableShape(annotation);
      this.selectedShape.element.annotation = annotation;     

      // Instantly reproject the original annotation to viewport coorods
      const projected = imageAnnotationToViewport(this.viewer, annotation);
      this.selectedShape.updateState(projected);

      // Disable normal OSD nav
      const editableShapeMouseTracker = new OpenSeadragon.MouseTracker({
        element: this.svg,

        preProcessEventHandler: info => {
          info.stopPropagation = true;
          info.preventDefault = false;
          info.preventGesture = true;
        }
      }).setTracking(false);

      // En-/disable OSD nav based on hover status
      this.selectedShape.element.addEventListener('mouseenter', () => {
        this.hoveredShape = this.selectedShape;
        editableShapeMouseTracker.setTracking(true);
      });

      this.selectedShape.element.addEventListener('mouseleave', () => {
        this.hoveredShape = null;
        editableShapeMouseTracker.setTracking(false);
      });

      this.selectedShape.mouseTracker = editableShapeMouseTracker;

      this.selectedShape.on('update', fragment => {
        // Fragment is in viewport coordinates - project back to image coords...
        const projectedTarget = viewportTargetToImage(this.viewer, fragment);

        // ...and update element.annotation, so everything stays in sync
        this.selectedShape.element.annotation =
          this.selectedShape.annotation.clone({ target: projectedTarget });

        this.emit('updateTarget', this.selectedShape.element, projectedTarget)
      });
    } else {
      this.selectedShape = shape;
      addClass(shape, 'selected');

      if (!skipEvent)
        this.emit('select', { annotation, element: shape, skipEvent });   
    }
  }

}