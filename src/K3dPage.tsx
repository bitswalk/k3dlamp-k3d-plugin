import { ConfigStore, K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';
import React from 'react';
import { Prompt } from 'react-router-dom';
import {
  contextName,
  createCluster,
  deleteCluster,
  describeFailure,
  K3dCluster,
  K3dStatus,
  probe,
  stripAnsi,
  validateConfigPath,
} from './k3d';

export const PACKAGE_NAME = '@bitswalk/headlamp-k3d';

const settings = new ConfigStore<{ configPath?: string }>(PACKAGE_NAME);
const useSettings = settings.useConfig();

// Keep the output panel bounded while k3d streams progress.
const MAX_OUTPUT_CHARS = 64 * 1024;

type Outcome =
  | { severity: 'success'; text: string; cluster?: string }
  | { severity: 'error'; text: string };

function ClusterLink({ name }: { name: string }) {
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

export default function K3dPage() {
  const savedPath = useSettings()?.configPath ?? '';
  const [status, setStatus] = React.useState<K3dStatus | null>(null);
  const [configPath, setConfigPath] = React.useState(savedPath);
  const [running, setRunning] = React.useState<string | null>(null);
  const [output, setOutput] = React.useState('');
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [toDelete, setToDelete] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setStatus(null);
    const next = await probe();
    setStatus(next);
    return next;
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  function appendOutput(chunk: string) {
    // Strip the joined text, so a colour code split across chunks is still removed.
    setOutput(previous => stripAnsi(previous + chunk).slice(-MAX_OUTPUT_CHARS));
  }

  async function handleCreate() {
    const before = new Set(status?.state === 'ready' ? status.clusters.map(c => c.name) : []);
    settings.update({ configPath });
    setRunning('Creating cluster');
    setOutput('');
    setOutcome(null);
    try {
      const result = await createCluster(configPath, appendOutput);
      const after = await refresh();
      if (result.code !== 0) {
        setOutcome({ severity: 'error', text: describeFailure(result) });
        return;
      }
      const created =
        after.state === 'ready' ? after.clusters.find(c => !before.has(c.name)) : undefined;
      setOutcome({
        severity: 'success',
        text: created ? `Cluster ${created.name} is ready.` : 'k3d reported success.',
        cluster: created?.name,
      });
    } catch (err) {
      setOutcome({ severity: 'error', text: (err as Error).message });
    } finally {
      setRunning(null);
    }
  }

  async function handleDelete(name: string) {
    setToDelete(null);
    setRunning(`Deleting cluster ${name}`);
    setOutput('');
    setOutcome(null);
    try {
      const result = await deleteCluster(name, appendOutput);
      await refresh();
      setOutcome(
        result.code === 0
          ? { severity: 'success', text: `Cluster ${name} was deleted.` }
          : { severity: 'error', text: describeFailure(result) }
      );
    } catch (err) {
      setOutcome({ severity: 'error', text: (err as Error).message });
    } finally {
      setRunning(null);
    }
  }

  const ready = status?.state === 'ready';
  const pathError = configPath === '' ? null : validateConfigPath(configPath);

  return (
    <>
      <Prompt when={running !== null} message="k3d is still running. Leave this page anyway?" />

      <SectionBox title="k3d">
        {status === null && (
          <Alert severity="info" icon={<CircularProgress size={18} />}>
            Checking k3d…
          </Alert>
        )}
        {status?.state === 'unavailable' && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={refresh} disabled={running !== null}>
                Retry
              </Button>
            }
          >
            {status.reason}
          </Alert>
        )}
        {status?.state === 'ready' && (
          <SimpleTable
            emptyMessage="k3d is installed and has no clusters."
            columns={[
              { label: 'Cluster', getter: (c: K3dCluster) => <ClusterLink name={c.name} /> },
              {
                label: 'Servers',
                getter: (c: K3dCluster) => `${c.serversRunning}/${c.serversCount}`,
              },
              {
                label: 'Agents',
                getter: (c: K3dCluster) => `${c.agentsRunning}/${c.agentsCount}`,
              },
              {
                label: '',
                getter: (c: K3dCluster) => (
                  <Button
                    color="error"
                    size="small"
                    disabled={running !== null}
                    onClick={() => setToDelete(c.name)}
                  >
                    Delete
                  </Button>
                ),
              },
            ]}
            data={status.clusters}
          />
        )}
      </SectionBox>

      <SectionBox title="Create a cluster">
        <Box display="flex" gap={2} alignItems="flex-start">
          <TextField
            label="k3d config file"
            placeholder="/path/to/cluster.yaml"
            helperText={pathError ?? 'Absolute path to a k3d.io/v1alpha5 Simple config.'}
            error={pathError !== null}
            value={configPath}
            onChange={event => setConfigPath(event.target.value)}
            disabled={!ready || running !== null}
            fullWidth
            size="small"
          />
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!ready || running !== null || validateConfigPath(configPath) !== null}
          >
            Create
          </Button>
        </Box>

        {running && (
          <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mt: 2 }}>
            {running}…
          </Alert>
        )}
        {outcome && (
          <Alert severity={outcome.severity} sx={{ mt: 2 }}>
            {outcome.text}
            {outcome.severity === 'success' && outcome.cluster && (
              <>
                {' '}
                Open <ClusterLink name={outcome.cluster} />.
              </>
            )}
          </Alert>
        )}
        {output && (
          <Box
            component="pre"
            sx={{
              mt: 2,
              p: 1,
              maxHeight: 320,
              overflow: 'auto',
              fontSize: '0.8rem',
              whiteSpace: 'pre-wrap',
              bgcolor: 'action.hover',
            }}
          >
            {output}
          </Box>
        )}
      </SectionBox>

      <Dialog open={toDelete !== null} onClose={() => setToDelete(null)}>
        <DialogTitle>Delete cluster {toDelete}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            k3d removes the cluster's containers, volumes and kubeconfig context. This cannot be
            undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)}>Cancel</Button>
          <Button color="error" onClick={() => toDelete && handleDelete(toDelete)}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
