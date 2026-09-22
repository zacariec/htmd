import { registerHtmdElements } from '@zacariec/htmd-elements';
import type { JSX } from 'react';
import { useState } from 'react';
import { StaticTab } from './static-tab.js';
import { StreamingTab } from './streaming-tab.js';

registerHtmdElements();

type Tab = 'static' | 'streaming';

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('static');

  return (
    <div className="app">
      <header>
        <h1>.htmd playground</h1>
        <div className="tabs">
          <button type="button" onClick={() => setTab('static')} data-active={tab === 'static'}>
            Static
          </button>
          <button
            type="button"
            onClick={() => setTab('streaming')}
            data-active={tab === 'streaming'}
          >
            Streaming
          </button>
        </div>
      </header>
      <main>{tab === 'static' ? <StaticTab /> : <StreamingTab />}</main>
    </div>
  );
}
