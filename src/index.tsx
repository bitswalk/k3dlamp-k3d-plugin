import {
  registerAddClusterProvider,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import K3dPage from './K3dPage';

const ROUTE = '/k3d';

function K3dIcon(props: React.SVGAttributes<SVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={48} height={48} aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3 6.9 3.8L12 12 5.1 8.1 12 4.3zM5 9.8l6 3.4v6.6l-6-3.3V9.8zm8 10V13.2l6-3.4v6.7l-6 3.3z"
      />
    </svg>
  );
}

registerSidebarEntry({
  parent: null,
  name: 'k3d',
  label: 'k3d',
  url: ROUTE,
  useClusterURL: false,
  icon: 'mdi:cube-outline',
  sidebar: 'HOME',
});

registerRoute({
  path: ROUTE,
  sidebar: { item: 'k3d', sidebar: 'HOME' },
  name: 'k3d',
  component: () => <K3dPage />,
  exact: true,
  useClusterURL: false,
  noAuthRequired: true,
});

registerAddClusterProvider({
  title: 'k3d',
  icon: K3dIcon,
  description:
    'Create a k3s cluster in Docker with the k3d installed on this machine. Needs a Headlamp ' +
    'desktop build whose app-build-manifest.json grants this plugin its k3d commands, such as k3dlamp.',
  url: ROUTE,
});
