import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { LightTooltip, Link, Table } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { contextName, K3dCluster } from './k3d';

type HeadlampCluster = NonNullable<ReturnType<typeof K8s.useClustersConf>>[string];
type VersionError = ReturnType<typeof K8s.useClustersVersion>[1][string];

interface Row {
  /** k3d's name for the cluster. */
  name: string;
  /** The kubeconfig context k3d writes for it, and so its name in Headlamp. */
  context: string;
  /** Whether k3d reports none of its servers running, as after `k3d cluster stop`. */
  stopped: boolean;
  /** Headlamp's cluster, when the kubeconfig has the context. */
  cluster?: HeadlampCluster;
}

// The status kinds Headlamp's home page shows, with its icons.
const STATUS = {
  active: { icon: 'mdi:cloud-check-variant', colorKey: 'success', coloredText: true },
  error: { icon: 'mdi:cloud-off', colorKey: 'error', coloredText: true },
  unknown: { icon: 'mdi:cloud-question', colorKey: 'unknown', coloredText: false },
  stopped: { icon: 'mdi:cloud-off', colorKey: 'unknown', coloredText: false },
} as const;

// The most warnings the home page counts before it shows "50+".
const MAX_WARNINGS = 50;

// Headlamp's Table renders a cell again only when the cell's value changes, so
// a cell that depends on anything else reads it here or from Headlamp's store.
const RowActions = React.createContext<{ busy: boolean; onDelete: (name: string) => void }>({
  busy: true,
  onDelete: () => {},
});

/** A k3d cluster's Headlamp cluster, linked once the kubeconfig has its context. */
export function ClusterLink({ name }: { name: string }) {
  const known = K8s.useClustersConf() ?? {};
  const context = contextName(name);
  if (!known[context]) {
    return <span title="Not in your kubeconfig">{context}</span>;
  }
  return (
    <Link routeName="cluster" params={{ cluster: context }}>
      {context}
    </Link>
  );
}

/** What the Status column says about a cluster, in the home page's words. */
function statusText(row: Row, error: VersionError | undefined): string {
  if (!row.cluster) {
    return 'Not in kubeconfig';
  }
  // Headlamp would only report it unavailable; k3d knows why.
  if (row.stopped) {
    return 'Stopped';
  }
  if (error === undefined) {
    return 'Connecting…';
  }
  if (error === null) {
    return 'Active';
  }
  if (error.status === 401) {
    return 'Authentication required';
  }
  if (error.status === 403) {
    return 'Insufficient permissions';
  }
  return 'Unavailable';
}

/** Where Headlamp picked the cluster up from, as the home page's Origin column says. */
function origin(cluster?: HeadlampCluster): string {
  switch (cluster?.meta_data?.source) {
    case undefined:
      return '';
    case 'kubeconfig': {
      const path = cluster.meta_data?.origin?.kubeconfig;
      return path ? `Kubeconfig: ${path}` : 'Kubeconfig';
    }
    case 'dynamic_cluster':
      return 'Plugin';
    case 'incluster':
      return 'In-cluster';
    default:
      return 'Unknown';
  }
}

/** How to fix a status the plugin can't fix itself, as a tooltip's text. */
function statusHint(row: Row): string | null {
  if (!row.cluster) {
    return `k3d has this cluster, but your kubeconfig has no ${row.context} context. Run: k3d kubeconfig merge ${row.name} --kubeconfig-merge-default --kubeconfig-switch-context=false`;
  }
  if (row.stopped) {
    return `k3d reports no running server for this cluster. Run: k3d cluster start ${row.name}`;
  }
  return null;
}

function ClusterStatus({ row, error }: { row: Row; error: VersionError | undefined }) {
  const theme = useTheme();
  const text = statusText(row, error);

  if (row.cluster && !row.stopped && error === undefined) {
    return (
      <Box display="flex" alignItems="center" width="fit-content">
        <CircularProgress size={14} />
        <Typography variant="body2" sx={{ ml: 1, color: theme.palette.text.secondary }}>
          {text}
        </Typography>
      </Box>
    );
  }

  const variant = !row.cluster
    ? STATUS.unknown
    : row.stopped
    ? STATUS.stopped
    : error === null
    ? STATUS.active
    : STATUS.error;
  const color = theme.palette.home.status[variant.colorKey];
  const content = (
    <Box display="flex" alignItems="center" width="fit-content">
      <Icon icon={variant.icon} width={16} color={color} />
      <Typography variant="body2" sx={{ ml: 1, color: variant.coloredText ? color : undefined }}>
        {text}
      </Typography>
    </Box>
  );

  const hint = statusHint(row);
  return hint ? <LightTooltip title={hint}>{content}</LightTooltip> : content;
}

/** The home page's Actions menu, with k3d's delete in place of Headlamp's. */
function ClusterMenu({ row }: { row: Row }) {
  const history = useHistory();
  const { busy, onDelete } = React.useContext(RowActions);
  const inKubeconfig = Boolean(K8s.useClustersConf()?.[row.context]);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const menuId = `k3d-cluster-menu-${row.name}`;

  function go(routeName: string) {
    setAnchor(null);
    history.push(Router.createRouteURL(routeName, { cluster: row.context }));
  }

  return (
    <>
      <Tooltip title="Actions">
        <IconButton
          size="small"
          onClick={event => setAnchor(event.currentTarget)}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-label="Actions"
        >
          <Icon icon="mdi:more-vert" />
        </IconButton>
      </Tooltip>
      <Menu id={menuId} anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem disabled={!inKubeconfig} onClick={() => go('cluster')}>
          <ListItemText>View</ListItemText>
        </MenuItem>
        <MenuItem disabled={!inKubeconfig} onClick={() => go('settingsCluster')}>
          <ListItemText>Settings</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={busy}
          onClick={() => {
            setAnchor(null);
            onDelete(row.name);
          }}
        >
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

/**
 * k3d's clusters, laid out like the clusters table on Headlamp's home page.
 *
 * Its warnings query keeps the clusters it started with, so give it a key that
 * changes with the clusters, and it remounts when one is added or deleted.
 */
export default function ClusterTable({
  clusters,
  busy,
  onDelete,
}: {
  clusters: K3dCluster[];
  busy: boolean;
  onDelete: (name: string) => void;
}) {
  const history = useHistory();
  const known = K8s.useClustersConf() ?? {};
  const rows: Row[] = clusters.map(({ name, serversCount, serversRunning }) => {
    const context = contextName(name);
    return {
      name,
      context,
      stopped: serversCount > 0 && serversRunning === 0,
      cluster: known[context],
    };
  });
  const inKubeconfig = rows.flatMap(row => (row.cluster ? [row.cluster] : []));
  const [versions, errors] = K8s.useClustersVersion(inKubeconfig);
  const warnings = K8s.event.useEventWarningList(inKubeconfig.map(cluster => cluster.name));

  function warningCount(row: Row): string {
    if (!row.cluster || row.stopped) {
      return '';
    }
    const result = warnings[row.context];
    if (!result || result.error) {
      return '⋯';
    }
    const count = result.warnings.length;
    return count >= MAX_WARNINGS ? `${MAX_WARNINGS}+` : String(count);
  }

  return (
    <RowActions.Provider value={{ busy, onDelete }}>
      <Table<Row>
        columns={[
          {
            id: 'name',
            header: 'Name',
            accessorKey: 'context',
            gridTemplate: 2,
            Cell: ({ row: { original } }) => <ClusterLink name={original.name} />,
          },
          {
            id: 'origin',
            header: 'Origin',
            accessorFn: row => origin(row.cluster),
            Cell: ({ row: { original } }) => (
              <Typography variant="body2">{origin(original.cluster)}</Typography>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            accessorFn: row => statusText(row, errors[row.context]),
            Cell: ({ row: { original } }) => (
              <ClusterStatus row={original} error={errors[original.context]} />
            ),
          },
          {
            id: 'warnings',
            header: 'Warnings',
            accessorFn: warningCount,
          },
          {
            id: 'version',
            header: 'Kubernetes Version',
            accessorFn: row =>
              row.cluster && !row.stopped ? versions[row.context]?.gitVersion || '⋯' : '',
          },
          {
            id: 'actions',
            header: 'Actions',
            gridTemplate: 'min-content',
            muiTableBodyCellProps: { align: 'right' },
            Cell: ({ row: { original } }) => <ClusterMenu row={original} />,
            enableSorting: false,
            enableColumnFilter: false,
          },
        ]}
        data={rows}
        getRowId={row => row.name}
        initialState={{ sorting: [{ id: 'name', desc: false }] }}
        // As on the home page: open the clusters that answer, together.
        enableRowSelection={row => errors[row.original.context] === null}
        muiToolbarAlertBannerProps={{
          sx: theme => ({ background: theme.palette.background.muted }),
        }}
        renderToolbarAlertBannerContent={({ table }) => (
          <Button
            variant="contained"
            sx={{ ml: 1 }}
            onClick={() => {
              const selected = table.getSelectedRowModel().rows.map(it => it.original.context);
              history.push(Router.createRouteURL('cluster', { cluster: selected.join('+') }));
            }}
          >
            View Clusters
          </Button>
        )}
      />
    </RowActions.Provider>
  );
}
