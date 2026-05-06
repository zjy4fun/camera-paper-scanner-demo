import { CapturedImage } from '../App';

type Props = {
  images: CapturedImage[];
  onPreview: (image: CapturedImage) => void;
};

export function CaptureList({ images, onPreview }: Props) {
  return (
    <aside className="capture-list">
      <div className="list-header">
        <h2>截图列表</h2>
        <span>{images.length}/20</span>
      </div>

      {images.length === 0 ? (
        <p className="empty">暂无截图。检测到纸张后点击“截图”。</p>
      ) : (
        <div className="items">
          {images.map((image, index) => (
            <button key={image.id} type="button" className="capture-item" onClick={() => onPreview(image)}>
              <img src={image.dataUrl} alt={`截图 ${images.length - index}`} />
              <div>
                <strong>#{images.length - index}</strong>
                <span>{image.createdAt}</span>
                <span>{image.width} × {image.height}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
