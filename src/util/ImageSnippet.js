import { hasClass } from '@recogito/annotorious/src';

export const getSnippet = (viewer, element) => {
  // Annotation shape could be the element itself or a 
  // child (in case of editable shapes, the element would be 
  // the group with shape + handles)
  const shape = hasClass(element, '.a9s-annotation') ? 
    element : element.querySelector('.a9s-annotation');

  // Scale factor for OSD canvas element (physical vs. logical resolution)
  const { canvas } = viewer.drawer;
  const canvasBounds = canvas.getBoundingClientRect();
  const kx = canvas.width / canvasBounds.width;
  const ky = canvas.height / canvasBounds.height;

  const shapeBounds = shape.getBoundingClientRect();

  const x = shapeBounds.x - canvasBounds.x;
  const y = shapeBounds.y - canvasBounds.y;
  const { width, height } = shapeBounds;

  // Cut out the image snippet as in-memory canvas element
  const snippet = document.createElement('CANVAS');
  const ctx = snippet.getContext('2d');
  snippet.width = width;
  snippet.height = height;
  ctx.drawImage(canvas, x * kx, y * ky, width * kx, height * ky, 0, 0, width, height);

  // Compute reverse transform
  const topLeft = viewer.viewport.viewportToImageCoordinates(shapeBounds.x, shapeBounds.y);
  const imageZoom = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom()); 

  return { 
    snippet, 
    transform: xy => {
      const px = topLeft.x + (xy[0] / kx) / imageZoom;
      const py = topLeft.y + (xy[1] / ky) / imageZoom;
      return [ px, py ];
    }
  };
}