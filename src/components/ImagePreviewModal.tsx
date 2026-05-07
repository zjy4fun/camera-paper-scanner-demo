import { CapturedImage } from '../App';

type Props = {
  image: CapturedImage | null;
  onClose: () => void;
};

export function ImagePreviewModal({ image, onClose }: Props) {
  if (!image) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <strong>图片预览</strong>
            <span>{image.createdAt} · {image.width} × {image.height}</span>
            <span>{image.mode === 'document' ? '纸张矫正增强' : '图像增强'}{image.cropped ? ' · 已裁剪' : ''}</span>
          </div>
          <button type="button" className="secondary" onClick={onClose}>关闭</button>
        </div>
        <img src={image.dataUrl} alt="截图预览" />
      </div>
    </div>
  );
}
