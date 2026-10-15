import { createApp } from './app.js';

const server = createApp();
const port = Number(process.env.PORT ?? 3001);
const address = await server.listen(port, process.env.HOST ?? '0.0.0.0');
console.log(`Monopoly room server is listening on port ${address.port}`);
console.log('Run npm run dev for the Vite development UI, or npm run build before npm start.');

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await server.close();
  process.exit(0);
});
