import { registerHtmdElements } from '@htmdjs/elements';
import type { JSX } from 'react';
import { useState } from 'react';
import { KitchenSinkTab } from './kitchen-sink-tab.js';
import { StaticTab } from './static-tab.js';
import { StreamingTab } from './streaming-tab.js';

registerHtmdElements();

type Tab = 'sink' | 'static' | 'streaming';

const TABS: Readonly<Record<Tab, string>> = {
  sink: 'Kitchen sink',
  static: 'Static',
  streaming: 'Wire replays',
};

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('sink');

  return (
    <div className="app">
      <header>
        <h1>.htmd playground</h1>
        <div className="tabs">
          {Object.entries(TABS).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value as Tab)}
              data-active={tab === value}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <main>
        {tab === 'sink' ? <KitchenSinkTab /> : tab === 'static' ? <StaticTab /> : <StreamingTab />}
      </main>
    </div>
  );
}
