import { LitElement, css, html } from 'lit';
import { defineOnce } from './define-once.js';

export class ImageCard extends LitElement {
  public static override styles = css`
    :host {
      display: block;
      border-radius: 8px;
      overflow: hidden;
      background: var(--htmd-image-bg, #0a0a0a);
    }
    .frame {
      position: relative;
      width: 100%;
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    figcaption {
      padding: 8px 12px;
      font-size: 13px;
      opacity: 0.8;
    }
  `;

  public static override properties = {
    src: { type: String, reflect: true },
    alt: { type: String, reflect: true },
    width: { type: Number },
    height: { type: Number },
    caption: { type: String },
  };

  public src: string = '';
  public alt: string = '';
  public width: number | undefined = undefined;
  public height: number | undefined = undefined;
  public caption: string = '';

  public override render(): unknown {
    const aspectRatio = this.aspectRatioStyle();
    return html`
      <figure>
        <div class="frame" style=${aspectRatio}>
          <img src=${this.src} alt=${this.alt} loading="lazy" />
        </div>
        ${this.caption.length > 0 ? html`<figcaption>${this.caption}</figcaption>` : null}
      </figure>
    `;
  }

  private aspectRatioStyle(): string {
    if (this.width === undefined || this.height === undefined) {
      return '';
    }
    return `aspect-ratio: ${this.width} / ${this.height};`;
  }
}

defineOnce('image-card', ImageCard);
