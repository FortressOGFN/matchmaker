import express from 'express';
import { NovaClient } from 'nova-matchmaker/sdk';

const nova = new NovaClient({ baseUrl: 'http://127.0.0.1:8080', apiKey: process.env.NOVA_API_KEY });
const app = express();

app.get('/fortnite/api/game/v2/matchmakingservice/ticket/player/:accountId', async (req, res) => {
  try {
    const ticket = await nova.createTicket(req.params.accountId, req.query as Record<string, unknown>);
    res.json(ticket);
  } catch (error: any) {
    res.status(error.status || 500).json({ errorMessage: error.message });
  }
});

app.get('/fortnite/api/matchmaking/session/:sessionId', async (req, res) => {
  try {
    res.json(await nova.getEpicSession(req.params.sessionId));
  } catch (error: any) {
    res.status(error.status || 404).json({ errorMessage: error.message });
  }
});

app.post('/fortnite/api/matchmaking/session/:sessionId/join', (_req, res) => res.status(204).end());

app.listen(3551);
