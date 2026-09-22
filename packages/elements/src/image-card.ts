import { LitElement, css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';

import { sanitizeUrl } from './internal/sanitize-url.js';

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

  public override render(): TemplateResult {
    const aspectRatio = this.aspectRatioStyle();
    const safeSrc = this.src.length > 0 ? sanitizeUrl(this.src) : undefined;
    return html`
      <figure>
        <div class="frame" style=${aspectRatio}>
          <img src=${safeSrc ?? nothing} alt=${this.alt} loading="lazy" />
        </div>
        ${this.caption.length > 0 ? html`<figcaption>${this.caption}</figcaption>` : undefined}
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
