const http = require('http');
const net = require('net');
const url = require('url');

const port = process.env.PORT || 8080;

// Твои логин и пароль
const PROXY_USER = process.env.PROXY_USER || 'user';
const PROXY_PASS = process.env.PROXY_PASS || 'password';
const authString = 'Basic ' + Buffer.from(`${PROXY_USER}:${PROXY_PASS}`).toString('base64');

// Функция проверки авторизации
function checkAuth(req, res) {
    const auth = req.headers['proxy-authorization'];
    if (!auth || auth !== authString) {
        res.writeHead(407, {
            'Proxy-Authenticate': 'Basic realm="Proxy Auth"',
            'Content-Type': 'text/plain'
        });
        res.end('Proxy authentication required');
        return false;
    }
    return true;
}

// Создаем сервер
const server = http.createServer((req, res) => {
    // Эндпоинт для пинга (чтобы Render не спал)
    if (req.url === '/ping') {
        res.writeHead(200);
        res.end('pong');
        return;
    }

    // Проверяем авторизацию для обычных HTTP запросов
    if (!checkAuth(req, res)) return;

    // Обработка обычных HTTP запросов
    const reqUrl = url.parse(req.url);
    const options = {
        hostname: reqUrl.hostname,
        port: reqUrl.port || 80,
        path: reqUrl.path,
        method: req.method,
        headers: req.headers
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error('HTTP Proxy error:', err.message);
        res.end();
    });

    req.pipe(proxyReq);
});

// ОБРАБОТКА HTTPS (САМОЕ ВАЖНОЕ)
// Перехватываем метод CONNECT для создания TCP-туннеля
server.on('connect', (req, clientSocket, head) => {
    // 1. Проверяем авторизацию для туннеля
    const auth = req.headers['proxy-authorization'];
    if (!auth || auth !== authString) {
        clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Proxy Auth"\r\n\r\n');
        clientSocket.end();
        return;
    }

    // 2. Извлекаем хост и порт из запроса
    const { port, hostname } = url.parse(`http://${req.url}`);

    // 3. Создаем прямое TCP соединение с целевым сервером
    const serverSocket = net.connect(port || 443, hostname, () => {
        // Отвечаем браузеру, что туннель установлен
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                           'Proxy-agent: Node.js-Proxy\r\n' +
                           '\r\n');
        
        // Сшиваем сокеты браузера и целевого сервера
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
        console.error(`TCP Proxy error for ${hostname}:`, err.message);
        clientSocket.end();
    });

    clientSocket.on('error', (err) => {
        console.error('Client socket error:', err.message);
        serverSocket.end();
    });
});

server.listen(port, () => {
    console.log(`Proxy server is running on port ${port}`);
});
