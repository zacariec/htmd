import { authorizeComponentUrl, requestHtmdHost } from '@htmdjs/contracts';
import { LitElement, css, html } from 'lit';
import type { TemplateResult } from 'lit';

/**
 * `<image-card>` — an image with required alt text and optional caption.
 *
 * `src` loads only when the host authorizes it for "image"; otherwise the alt
 * text is shown in the image's place.
 */
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
    .placeholder {
      display: grid;
      place-items: center;
      box-sizing: border-box;
      height: 100%;
      min-height: 64px;
      padding: 16px;
      font-size: 13px;
      opacity: 0.8;
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
    const url =
      this.src.length > 0
        ? authorizeComponentUrl(this, this.src, 'image', requestHtmdHost(this))
        : undefined;
    return html`
      <figure>
        <div class="frame" style=${this.aspectRatioStyle()}>
          ${
            url === undefined
              ? html`<div class="placeholder" role="img" aria-label=${this.alt}>${this.alt}</div>`
              : html`<img src=${url.href} alt=${this.alt} loading="lazy" />`
          }
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
