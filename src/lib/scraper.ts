import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { Mutex } from 'async-mutex';

import { fetchYoutubeWatchPage, isYoutubeWatchUrl } from './youtubeWatch';

export type ScrapedPage = {
  content: string;
  title: string;
  /** ISO 8601, only for sources that state one exactly. */
  publishedDate?: string;
};

class Scraper {
  private static browser: any | undefined;
  private static IDLE_KILL_TIMEOUT = 30000;
  private static NAVIGATION_TIMEOUT = 20000;
  private static idleTimeout: NodeJS.Timeout | undefined;
  private static browserMutex = new Mutex();
  private static userCount = 0;

  private static async initBrowser() {
    await this.browserMutex.runExclusive(async () => {
      if (!this.browser) {
        const { chromium } = await import('playwright');
        this.browser = await chromium.launch({
          headless: true,
          channel: 'chromium-headless-shell',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
          ],
        });
      }

      if (this.idleTimeout) clearTimeout(this.idleTimeout);
    });
  }

  private static scheduleIdleKill() {
    if (this.idleTimeout) clearTimeout(this.idleTimeout);

    this.idleTimeout = setTimeout(async () => {
      await this.browserMutex.runExclusive(async () => {
        if (this.browser && this.userCount === 0) {
          {
            await this.browser.close();
            this.browser = undefined;
          }
        }
      });
    }, this.IDLE_KILL_TIMEOUT);
  }

  static async scrape(url: string, signal?: AbortSignal): Promise<ScrapedPage> {
    signal?.throwIfAborted();

    // Readability on a watch page returns the player chrome, not the video, so
    // the browser is skipped entirely when the page's own JSON will answer.
    // A null means it did not, and the generic path still gets its turn.
    if (isYoutubeWatchUrl(url)) {
      const watch = await fetchYoutubeWatchPage(url, signal);

      if (watch) {
        return {
          title: watch.title,
          content: `
        # ${watch.title || 'No title'} - ${url}
        ${watch.description || 'No description available'}
        `,
          ...(watch.publishedDate ? { publishedDate: watch.publishedDate } : {}),
        };
      }
    }

    await this.initBrowser();
    signal?.throwIfAborted();

    if (!this.browser) throw new Error('Browser not initialized');

    const context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();
    const onAbort = () => {
      void page.close().catch(() => undefined);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    this.userCount++;

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.NAVIGATION_TIMEOUT,
      });
      signal?.throwIfAborted();

      await page
        .waitForLoadState('load', { timeout: 5000 })
        .catch(() => undefined);
      await page.waitForTimeout(500);

      const html = await page.content();

      const dom = new JSDOM(html, {
        url,
      });

      const content = new Readability(dom.window.document).parse();

      const title = await page.title();

      return {
        content: `
        # ${title ?? 'No title'} - ${url}
        ${content?.textContent?.trim() ?? 'No content available'}
        `,
        title,
      };
    } catch (err) {
      console.log(`Error scraping ${url}:`, err);

      return {
        title: 'Failed to scrape',
        content: `# ${url}\n\nError scraping content.`,
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.userCount--;

      await context.close().catch(() => undefined);

      if (this.userCount === 0) {
        this.scheduleIdleKill();
      }
    }
  }
}

export default Scraper;
