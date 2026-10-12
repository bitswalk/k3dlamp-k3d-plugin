import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clusterNameFromContext,
  contextName,
  CREATE_PREFIX,
  createCluster,
  DELETE_PREFIX,
  deleteCluster,
  describeFailure,
  GRANTS_URL,
  K3D,
  LIST_ARGS,
  probe,
  REQUIRED_COMMANDS,
  stripAnsi,
  validateConfigPath,
} from './k3d';

type Listener = (value: any) => void;

/** Stands in for Headlamp's injected pluginRunCommand and records each call. */
function fakeRunCommand(code: number | null, stdout = '', stderr = '') {
  const calls: Array<{ tool: string; args: string[]; options: object }> = [];
  const fn = vi.fn((tool: string, args: string[], options: object) => {
    calls.push({ tool, args, options });
    const out: Listener[] = [];
    const err: Listener[] = [];
    const exit: Listener[] = [];
    setTimeout(() => {
      if (stdout) out.forEach(l => l(stdout));
      if (stderr) err.forEach(l => l(stderr));
      exit.forEach(l => l(code));
    });
    return {
      stdout: { on: (_: string, l: Listener) => out.push(l) },
      stderr: { on: (_: string, l: Listener) => err.push(l) },
      on: (_: string, l: Listener) => exit.push(l),
    };
  });
  (globalThis as any).pluginRunCommand = fn;
  return calls;
}

afterEach(() => {
  delete (globalThis as any).pluginRunCommand;
});

const LIST_OUTPUT = JSON.stringify([
  {
    name: 'seed',
    clusterToken: 'must-not-leak',
    nodes: [],
    serversRunning: 1,
    serversCount: 1,
    agentsRunning: 0,
    agentsCount: 0,
  },
]);

describe('probe', () => {
  it('reports a build that injects no command capability as ungranted', async () => {
    expect(await probe()).toEqual({ state: 'ungranted' });
  });

  it('reports a build that refuses the list grant as ungranted', async () => {
    fakeRunCommand(-2);
    expect(await probe()).toEqual({ state: 'ungranted' });
  });

  it('lists clusters with the exact granted argv and keeps only display fields', async () => {
    const calls = fakeRunCommand(0, LIST_OUTPUT);
    const status = await probe();
    expect(calls).toEqual([{ tool: K3D, args: LIST_ARGS, options: {} }]);
    expect(status).toEqual({
      state: 'ready',
      clusters: [
        { name: 'seed', serversRunning: 1, serversCount: 1, agentsRunning: 0, agentsCount: 0 },
      ],
    });
    expect(JSON.stringify(status)).not.toContain('must-not-leak');
  });

  it.each([
    [
      -1,
      'spawn k3d ENOENT',
      /^k3d is not installed, or not on the PATH this app was started with\.$/,
    ],
    [-1, 'spawn k3d EACCES', /could not be started: spawn k3d EACCES/],
    [-3, '', /denied in the consent prompt, and the app keeps that choice\.$/],
    [1, 'FATA[0000] Cannot connect to the Docker daemon\n', /Cannot connect to the Docker daemon$/],
    [1, '\x1b[31mFATA\x1b[0m[0000] Docker is down\n', /^FATA\[0000\] Docker is down$/],
  ])('explains exit code %i', async (code, stderr, reason) => {
    fakeRunCommand(code, '', stderr);
    const status = await probe();
    expect(status.state).toBe('unavailable');
    expect(status.state === 'unavailable' && status.reason).toMatch(reason);
  });

  it('rejects output that is not a cluster array', async () => {
    fakeRunCommand(0, '{}');
    expect(await probe()).toEqual({
      state: 'unavailable',
      reason: expect.stringMatching(/Unexpected k3d output/),
    });
  });
});

describe('describeFailure', () => {
  it('points a refused grant at the README', () => {
    expect(describeFailure({ code: -2, stdout: '', stderr: '' })).toBe(
      `This build's app-build-manifest.json does not grant the plugin this k3d command. See ${GRANTS_URL}`
    );
  });
});

describe('createCluster', () => {
  it('appends only the config path to the granted prefix and streams output', async () => {
    const calls = fakeRunCommand(0, 'INFO[0001] Cluster created\n');
    const chunks: string[] = [];
    const result = await createCluster('/opt/bundle/seed.yaml', c => chunks.push(c));
    expect(calls).toEqual([
      { tool: K3D, args: [...CREATE_PREFIX, '/opt/bundle/seed.yaml'], options: {} },
    ]);
    expect(result.code).toBe(0);
    expect(chunks).toEqual(['INFO[0001] Cluster created\n']);
  });

  it.each(['', '  ', ' /seed.yaml', '--volume', '-c'])('refuses %j', path => {
    const calls = fakeRunCommand(0);
    expect(validateConfigPath(path)).not.toBeNull();
    expect(() => createCluster(path, () => {})).toThrow();
    expect(calls).toEqual([]);
  });
});

describe('deleteCluster', () => {
  it('appends only the cluster name to the granted prefix', async () => {
    const calls = fakeRunCommand(0);
    await deleteCluster('seed', () => {});
    expect(calls).toEqual([{ tool: K3D, args: [...DELETE_PREFIX, 'seed'], options: {} }]);
  });

  it.each(['--all', '-a', 'Seed', 'seed one', ''])('refuses %j', name => {
    const calls = fakeRunCommand(0);
    expect(() => deleteCluster(name, () => {})).toThrow();
    expect(calls).toEqual([]);
  });
});

describe('stripAnsi', () => {
  it('removes the colour codes k3d writes', () => {
    expect(stripAnsi('\x1b[36mINFO\x1b[0m[0000] Cluster created')).toBe(
      'INFO[0000] Cluster created'
    );
  });
});

describe('context names', () => {
  it('round-trips k3d names', () => {
    expect(contextName('seed')).toBe('k3d-seed');
    expect(clusterNameFromContext('k3d-seed')).toBe('seed');
    expect(clusterNameFromContext('kind-seed')).toBeNull();
    expect(clusterNameFromContext('k3d---all')).toBeNull();
  });
});

describe('command-grants.json', () => {
  // Products copy these grants into their manifest's runCommands, so they must
  // describe exactly the argv this module sends.
  const grants = JSON.parse(readFileSync(resolve(__dirname, '../command-grants.json'), 'utf8'));

  it('matches the commands the page lists for builds without them', () => {
    expect(REQUIRED_COMMANDS).toEqual([
      'k3d cluster list -o json',
      'k3d cluster create --config <path>',
      'k3d cluster delete <name>',
    ]);
  });

  it('lists exactly list, create and delete', () => {
    expect(grants).toEqual([
      { tool: K3D, args: LIST_ARGS },
      { tool: K3D, args: CREATE_PREFIX, allowTrailingArgs: true },
      { tool: K3D, args: DELETE_PREFIX, allowTrailingArgs: true },
    ]);
  });
});
