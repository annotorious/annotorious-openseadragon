import OpenSeadragon from 'openseadragon';
import { drawShape, shapeArea } from '@recogito/annotorious/src/selectors';
import { format } from '@recogito/annotorious/src/util/Formatting';
import { viewportTargetToImage, imageAnnotationToViewport, refreshViewportPosition } from '.';
import OSDAnnotationLayer from '../OSDAnnotationLayer';

export default class GigapixelAnnotationLayer extends OSDAnnotationLayer {

  constructor(props) {
    super(props);
    
    this.env = props.env;

    this._initDrawingMouseTracker();

    this.tools.on('complete', shape => {     
      // Annotation is in SVG coordinates - project to image coordinates  
      const reprojected = shape.annotation.clone({ target: viewportTargetToImage(this.viewer, shape.annotation.target) });
      shape.annotation = reprojected;

      this.selectShape(shape);
      this.emit('createSelection', shape.annotation);
      this.mouseTracker.setTracking(false);
    });
  }

  addAnnotation = annotation => {
    const shape = drawShape(annotation);

    shape.setAttribute('class', 'a9s-annotation');

    shape.setAttribute('data-id', annotation.id);
    shape.annotation = annotation;

    refreshViewportPosition(this.viewer, shape);

    this._attachMouseListeners(shape, annotation);

    this.g.appendChild(shape);

    format(shape, annotation, this.formatter);
  }

  init = annotations => {
    // Clear existing
    this.deselect();

    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation'));
    shapes.forEach(s => this.g.removeChild(s));

    // Add
    // annotations.sort((a, b) => shapeArea(b) - shapeArea(a));
    annotations.forEach(this.addAnnotation);
  }

  redraw = () => {
    // The selected annotation shape
    const selected = this.g.querySelector('.a9s-annotation.selected');

    // All other shapes and annotations
    const unselected = Array.from(this.g.querySelectorAll('.a9s-annotation:not(.selected)'));
    const annotations = unselected.map(s => s.annotation);
    annotations.sort((a, b) => shapeArea(b) - shapeArea(a));

    // Clear unselected annotations and redraw
    unselected.forEach(s => this.g.removeChild(s));
    annotations.forEach(this.addAnnotation);

    // Then re-draw the selected on top, if any
    if (selected) {
      // Editable shapes might be wrapped in additional group
      // elements (mask!), we need to get the top-level wrapper 
      // of .a9s-annotation.selected that sits directly 
      // beneath this.g
      let toRedraw = selected;
      
      while (toRedraw.parentNode !== this.g)
        toRedraw = toRedraw.parentNode;

      this.g.appendChild(toRedraw);
    } 

    this.resize();
  }

  resize() {
    // Update positions for all anntations except selected (will be handled separately)
    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation:not(.selected)'));
    shapes.forEach(s => refreshViewportPosition(this.viewer, s));

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
      this._removeMouseListeners(shape);

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

      // If we attach immediately 'mouseEnter' will fire when the editable shape
      // is added to the DOM!
      setTimeout(() => {
        // Can be undefined in headless mode, when saving immediately
        if (this.selectedShape)
          this._attachMouseListeners(this.selectedShape.element, annotation);
      }, 10);

      // Disable normal OSD nav
      const editableShapeMouseTracker = new OpenSeadragon.MouseTracker({
        element: this.svg
      }).setTracking(true);

      // En-/disable OSD nav based on hover status
      this.selectedShape.element.addEventListener('mouseenter', evt =>
        editableShapeMouseTracker.setTracking(true));

      this.selectedShape.element.addEventListener('mouseleave', evt =>
        editableShapeMouseTracker.setTracking(false));

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

      if (!skipEvent)
        this.emit('select', { annotation, element: shape, skipEvent });   
    }
  }

}