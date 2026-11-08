import dgram from 'dgram';
import os from 'os';

export interface PortProbe {
  isPortInUse(port: number): Promise<boolean>;
}

export const udpPortProbe: PortProbe = {
  isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: false });
      let settled = false;
      const finish = (inUse: boolean) => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {}
        resolve(inUse);
      };
      socket.once('error', (error: NodeJS.ErrnoException) => finish(error.code === 'EADDRINUSE' || error.code === 'EACCES'));
      socket.once('listening', () => finish(false));
      try {
        socket.bind({ port, address: '0.0.0.0', exclusive: true });
      } catch {
        finish(true);
      }
    });
  },
};

export function localAddresses(): Set<string> {
  const addresses = new Set<string>(['127.0.0.1', 'localhost', '0.0.0.0', '::1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list || []) addresses.add(entry.address);
  }
  return addresses;
}
