const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = 3000;
const COMPARTIDO_DIR = path.join(__dirname, 'Compartido');

if (!fs.existsSync(COMPARTIDO_DIR)) {
    fs.mkdirSync(COMPARTIDO_DIR);
}

function getSafePath(subpath) {
    const cleanPath = subpath ? decodeURIComponent(subpath) : '';
    const resolvedPath = path.join(COMPARTIDO_DIR, cleanPath);
    if (!resolvedPath.startsWith(COMPARTIDO_DIR)) {
        return COMPARTIDO_DIR;
    }
    return resolvedPath;
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.searchParams;

    // 1. Listar archivos y carpetas
    if (pathname === '/api/files' && req.method === 'GET') {
        const currentDir = getSafePath(query.get('dir'));

        fs.readdir(currentDir, (err, files) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No se pudo leer la carpeta' }));
                return;
            }

            const fileList = [];
            files.forEach(file => {
                const filePath = path.join(currentDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    const relativePath = path.relative(COMPARTIDO_DIR, filePath).split(path.sep).join('/');
                    
                    if (stats.isDirectory()) {
                        fileList.push({
                            name: file,
                            path: relativePath,
                            size: 'Carpeta',
                            isDir: true
                        });
                    } else {
                        fileList.push({
                            name: file,
                            path: relativePath,
                            size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
                            isDir: false,
                            url: `/files/${encodeURIComponent(relativePath)}`
                        });
                    }
                } catch (e) {}
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(fileList));
        });
        return;
    }

    // 2. Crear nueva carpeta
    if (pathname === '/api/create-folder' && req.method === 'POST') {
        let body = [];
        req.on('data', chunk => body.push(chunk));
        req.on('end', () => {
            try {
                const data = JSON.parse(Buffer.concat(body).toString());
                const targetDir = getSafePath(data.dir);
                const folderName = data.name ? path.basename(data.name) : '';
                
                if (folderName) {
                    const newFolderPath = path.join(targetDir, folderName);
                    if (!fs.existsSync(newFolderPath)) {
                        fs.mkdirSync(newFolderPath, { recursive: true });
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end('Carpeta creada con éxito');
                        return;
                    } else {
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end('La carpeta ya existe');
                        return;
                    }
                }
            } catch (e) {}
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Nombre inválido');
        });
        return;
    }

    // 3. Mover archivo
    if (pathname === '/api/move' && req.method === 'POST') {
        let body = [];
        req.on('data', chunk => body.push(chunk));
        req.on('end', () => {
            try {
                const data = JSON.parse(Buffer.concat(body).toString());
                const fileNameToMove = path.basename(data.file);
                const targetDir = getSafePath(data.targetDir);

                function encontrarArchivoPorNombre(dir, targetName) {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (let entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            const res = encontrarArchivoPorNombre(fullPath, targetName);
                            if (res) return res;
                        } else if (entry.name === targetName) {
                            return fullPath;
                        }
                    }
                    return null;
                }

                const origen = encontrarArchivoPorNombre(COMPARTIDO_DIR, fileNameToMove);
                const destino = path.join(targetDir, fileNameToMove);

                if (origen && fs.existsSync(origen) && fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
                    if (origen !== destino) {
                        fs.renameSync(origen, destino);
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end('Archivo movido con éxito');
                        return;
                    }
                }
            } catch (e) {}
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('No se pudo mover el archivo');
        });
        return;
    }

    // 4. Descargar archivos
    if (pathname.startsWith('/files/') && req.method === 'GET') {
        const filePathParam = pathname.replace('/files/', '');
        const filePath = getSafePath(filePathParam);

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Archivo no encontrado');
        }
        return;
    }

    // 5. Subir archivos (Sobrescribe automáticamente si ya existe el mismo nombre)
    if (pathname === '/api/upload' && req.method === 'POST') {
        const targetDir = getSafePath(query.get('dir'));
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            let body = [];
            req.on('data', chunk => body.push(chunk));
            req.on('end', () => {
                const buffer = Buffer.concat(body);
                try {
                    const boundary = contentType.split('boundary=')[1];
                    const parts = buffer.toString('binary').split(`--${boundary}`);
                    
                    for (let part of parts) {
                        if (part.includes('filename="')) {
                            const match = part.match(/filename="(.+?)"/);
                            if (match && match[1]) {
                                const filename = path.basename(match[1]);
                                const headerEndIndex = part.indexOf('\r\n\r\n');
                                const rawData = part.substring(headerEndIndex + 4);
                                const cleanData = rawData.substring(0, rawData.length - 2);
                                
                                const savePath = path.join(targetDir, filename);
                                fs.writeFileSync(savePath, cleanData, 'binary'); // Sobrescribe si el nombre es igual
                                
                                res.writeHead(200, { 'Content-Type': 'text/plain' });
                                res.end('¡Archivo subido con éxito!');
                                return;
                            }
                        }
                    }
                } catch (e) {}
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Error al procesar el archivo');
            });
        } else {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Formato no soportado');
        }
        return;
    }

    // 6. Servir la página web estática
    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 No encontrado');
            return;
        }
        let ext = path.extname(filePath);
        let contentType = 'text/html';
        if (ext === '.js') contentType = 'text/javascript';
        if (ext === '.css') contentType = 'text/css';
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

// ==========================================
// 7. CONFIGURACIÓN DE WEBSOCKETS (TIEMPO REAL)
// ==========================================
const io = new Server(server);

io.on('connection', (socket) => {
    socket.on('abrir-archivo', (relativePath) => {
        const filePath = getSafePath(relativePath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (!err) {
                    socket.join(relativePath);
                    socket.emit('contenido-archivo', { path: relativePath, content: data });
                }
            });
        }
    });

    socket.on('editar-archivo', (data) => {
        const { path: relativePath, content } = data;
        const filePath = getSafePath(relativePath);

        fs.writeFile(filePath, content, 'utf8', (err) => {
            if (!err) {
                socket.to(relativePath).emit('actualizar-archivo', content);
            }
        });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor local corriendo perfectamente en http://localhost:${PORT}`);
});
