const YAML = require("yaml");
const TOML = require("toml");
const fs = require('fs')
const path = require('path')
const axios = require("axios");
const atob = require("atob");

module.exports = async (req, res) => {
  const url = req.query.url;
  const target = req.query.target;
  const exclude = req.query.exclude || '过期|剩余|本站|网址|官网|注意';
  const include = req.query.include;
  const origin = req.query.origin;
  console.log(`query: ${JSON.stringify(req.query)}`);
  if (url === undefined) {
    res.status(400).send("Missing parameter: url");
    return;
  }

  console.log(`Fetching url: ${url}`);
  let configFile = null;
  let userAgent = "ClashX Pro/1.72.0.4 (com.west2online.ClashXPro; build:1.72.0.4; macOS 12.0.1) Alamofire/5.4.4";
  if(origin === "ssr"){
    userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36";
  }

  try {
    const result = await axios({
      url,
      headers: {
        "User-Agent":
          userAgent,
      },
    });
    configFile = result.data;
  } catch (error) {
    res.status(400).send(`Unable to get url, error: ${error}`);
    return;
  }

  let config = null;
  console.log(`Parsing YAML`);
  try {
    config = YAML.parse(configFile);
    console.log(`👌 Parsed YAML`);
  } catch (error) {
  }

  if (config.proxies === undefined) {
    var emoji;
    try {
      const data = fs.readFileSync(path.resolve("emoji.toml"), 'utf8')
      emoji = TOML.parse(data);
    } catch (err) {
      console.error(err)
    }


    configFile = atob(configFile);
    const links = configFile.split(/\r?\n/).filter(line => line.trim() !== "");
    const proxies = [];
    links.forEach(element => {
      let uri = element.split('://');
      const config = atob(uri[1]).split(':');

      let p = config[5].split("/?");
      let params = new URLSearchParams(p[1])
      let name = new Buffer(params.get("remarks"), "base64").toString();
      
      let e = emoji.emoji.find(e => name.match(e.match.replace("?i:",""))).emoji;

      let proxy = {
        name: e + " " +name,
        server: config[0],
        port: parseInt(config[1]),
        type: uri[0],
        password: atob(p[0]),
        cipher: config[3],
        obfs: config[4],
        protocol: config[2],
        'protocol-param': atob(params.get("protoparam")),
        'obfs-param': atob(params.get('obfsparam'))
      }
      proxies.push(proxy);
    });
    config = {
      proxies: proxies
    }
  }

  if (config.proxies === undefined) {
    res.status(400).send("No proxies in this config");
    return;
  }

  if (exclude){
    config.proxies = config.proxies.filter(proxy => {
      return !proxy.name.match(exclude);
    });
  }

  if (include){
    config.proxies = config.proxies.filter(proxy => {
      return proxy.name.match(include);
    });
  }

  if (target === "surge") {
    const supportedProxies = config.proxies.filter((proxy) =>
      ["ssr", "vmess", "trojan"].includes(proxy.type)
    );
    const surgeProxies = supportedProxies.map((proxy) => {
      console.log(proxy.server);
      const common = `${proxy.name} = ${proxy.type}, ${proxy.server}, ${proxy.port}`;
      if (proxy.type === "ssr") {
        // ProxySS = ss, example.com, 2021, encrypt-method=xchacha20-ietf-poly1305, password=12345, obfs=http, obfs-host=example.com, udp-relay=true
        if (proxy.plugin === "v2ray-plugin") {
          console.log(
            `Skip convert proxy ${proxy.name} because Surge does not support Shadowsocks with v2ray-plugin`
          );
          return;
        }
        let result = `${common}, encrypt-method=${proxy.cipher}, password=${proxy.password}`;
        if (proxy.plugin === "obfs") {
          const mode = proxy?.["plugin-opts"].mode;
          const host = proxy?.["plugin-opts"].host;
          result = `${result}, obfs=${mode}${
            host ? `, obfs-host=example.com ${host}` : ""
          }`;
        }
        if (proxy.udp) {
          result = `${result}, udp-relay=${proxy.udp}`;
        }
        return result;
      } else if (proxy.type === "vmess") {
        // ProxyVmess = vmess, example.com, 2021, username=0233d11c-15a4-47d3-ade3-48ffca0ce119, skip-cert-verify=true, sni=example.com, tls=true, ws=true, ws-path=/path
        if (["h2", "http", "grpc"].includes(proxy.network)) {
          console.log(
            `Skip convert proxy ${proxy.name} because Surge probably doesn't support Vmess(${proxy.network})`
          );
          return;
        }
        let result = `${common}, username=${proxy.uuid}`;
        if (proxy["skip-cert-verify"]) {
          result = `${result}, skip-cert-verify=${proxy["skip-cert-verify"]}`;
        }
        if (proxy.servername) {
          result = `${result}, sni=${proxy.servername}`;
        }
        if (proxy.tls) {
          result = `${result}, tls=${proxy.tls}`;
        }
        if (proxy.network === "ws") {
          result = `${result}, ws=true`;
        }
        if (proxy["ws-path"]) {
          result = `${result}, ws-path=${proxy["ws-path"]}`;
        }
        return result;
      } else if (proxy.type === "trojan") {
        // ProxyTrojan = trojan, example.com, 2021, username=user, password=12345, skip-cert-verify=true, sni=example.com
        if (["grpc"].includes(proxy.network)) {
          console.log(
            `Skip convert proxy ${proxy.name} because Surge probably doesn't support Trojan(${proxy.network})`
          );
          return;
        }
        let result = `${common}, password=${proxy.password}`;
        if (proxy["skip-cert-verify"]) {
          result = `${result}, skip-cert-verify=${proxy["skip-cert-verify"]}`;
        }
        if (proxy.sni) {
          result = `${result}, sni=${proxy.sni}`;
        }
        return result;
      }
    });
    const proxies = surgeProxies.filter((p) => p !== undefined);
    res.status(200).send(proxies.join("\n"));
  } else {
    const response = YAML.stringify({ proxies: config.proxies });
    res.status(200).send(response);
  }
};
