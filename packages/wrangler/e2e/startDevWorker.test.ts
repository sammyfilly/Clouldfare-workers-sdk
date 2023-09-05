import { Miniflare, type MiniflareOptions } from "miniflare";
import { WebSocket, fetch } from "undici";
import { beforeEach, afterEach, describe, test, expect } from "vitest";
import { DevEnv, type StartDevWorkerOptions } from "wrangler";

describe("startDevWorker: ProxyController", () => {
	let devEnv: DevEnv;
	let mf: Miniflare | undefined;

	beforeEach(() => {
		devEnv = new DevEnv();
	});
	afterEach(async () => {
		await new Promise((resolve) => setTimeout(resolve, 1000));

		await mf?.dispose();
		await devEnv?.teardown({ type: "teardown" });
	});

	test("ProxyWorker buffers requests while runtime reloads", async () => {
		const mfOpts: MiniflareOptions = {
			// verbose: true,
			port: 0,
			inspectorPort: 0,
			modules: true,
			compatibilityDate: "2023-08-01",
			name: "My-Worker",
			script: `export default {
                fetch(req) {

                    return new Response("body:1");
                }
            }`,
		};
		const config: StartDevWorkerOptions = {
			name: mfOpts.name ?? "",
			script: { contents: mfOpts.script },
		};

		const worker = devEnv.startWorker(config);

		devEnv.proxy.onConfigUpdate({
			type: "configUpdate",
			config,
		});

		devEnv.proxy.onReloadStart({
			type: "reloadStart",
			config,
			bundle: { format: "modules", modules: [] },
		});

		mf = new Miniflare(mfOpts);
		const url = await mf.ready;

		const { host } = url;
		const inspectorUrl = `ws://${url.hostname}:${mfOpts.inspectorPort}/core:user:My-Worker`;

		devEnv.proxy.onReloadComplete({
			type: "reloadComplete",
			config,
			bundle: { format: "modules", modules: [] },
			proxyData: {
				destinationURL: { host },
				destinationInspectorURL: inspectorUrl,
				headers: {},
			},
		});

		let res = await worker.fetch("http://dummy");

		await expect(res.text()).resolves.toBe("body:1");

		devEnv.proxy.onReloadStart({
			type: "reloadStart",
			config,
			bundle: { format: "modules", modules: [] },
		});

		mfOpts.script = mfOpts.script.replace("1", "2");
		await mf.setOptions(mfOpts);

		setTimeout(() => {
			devEnv.proxy.onReloadComplete({
				type: "reloadComplete",
				config,
				bundle: { format: "modules", modules: [] },
				proxyData: {
					destinationURL: { host },
					destinationInspectorURL: inspectorUrl,
					headers: {},
				},
			});
		}, 1000);

		res = await worker.fetch("http://dummy");
		await expect(res.text()).resolves.toBe("body:2");
	});

	test("InspectorProxyWorker discovery endpoints", async () => {
		const mfOpts: MiniflareOptions = {
			// verbose: true,
			port: 0,
			inspectorPort: 9777, // TODO: get workerd to report the inspectorPort so we can set 0 and retrieve the actual port later
			modules: true,
			compatibilityDate: "2023-08-01",
			name: "My-Worker",
			script: `export default {
	            fetch() {
                    console.log('Inside mock user worker');
	                return new Response("body:1");
	            }
	        }`,
		};
		const config: StartDevWorkerOptions = {
			name: mfOpts.name ?? "",
			script: { contents: mfOpts.script },
			dev: {
				inspector: { port: 9230 },
			},
		};

		const _worker = devEnv.startWorker(config);

		devEnv.proxy.onConfigUpdate({
			type: "configUpdate",
			config,
		});

		devEnv.proxy.onReloadStart({
			type: "reloadStart",
			config,
			bundle: { format: "modules", modules: [] },
		});

		mf = new Miniflare(mfOpts);
		const url = await mf.ready;
		const inspectorUrl = `ws://${url.hostname}:${mfOpts.inspectorPort}/core:user:My-Worker`;

		devEnv.proxy.onReloadComplete({
			type: "reloadComplete",
			config,
			bundle: { format: "modules", modules: [] },
			proxyData: {
				destinationURL: { host: url.host },
				destinationInspectorURL: inspectorUrl,
				headers: {},
			},
		});

		await devEnv.proxy.ready;
		const res = await fetch(`http://127.0.0.1:${9230}/json`);

		await expect(res.json()).resolves.toBeInstanceOf(Array);

		const ws = new WebSocket(inspectorUrl);
		const openPromise = new Promise((resolve) => {
			ws.addEventListener("message", (event) => {
				resolve(event);
			});
		});

		await expect(openPromise).resolves.toMatchObject({ type: "open" });
	});
});
