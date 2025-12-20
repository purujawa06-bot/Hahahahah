// @path lib/devServer.js
// @type write
const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { logInfo, logSuccess, logError, logWarning } = require('./logger');

const projectRoot = path.resolve(__dirname, '..');

// --- Helper: Get Files for Backup ---
function getFilesForBackup(dir, fileList = [], rootDir = dir) {
    // Daftar file yang WAJIB di-skip agar tidak ditolak GitHub atau membocorkan rahasia
    const EXCLUDED_FILES = [
        'firebase-key.json', // Mengandung Private Key (Penyebab Error)
        'package-lock.json', // Opsional, seringkali bikin bloat
        'yarn.lock',
        '.env',
        '.DS_Store'
    ];

    let files = [];
    try {
        files = fs.readdirSync(dir);
    } catch (err) {
        logError(`Failed to read dir ${dir}: ${err.message}`);
        return fileList;
    }

    files.forEach(file => {
        // Exclude files/dirs starting with dot OR exactly 'node_modules' OR in exclusion list
        if (file.startsWith('.') || file === 'node_modules' || EXCLUDED_FILES.includes(file)) {
            return;
        }
        
        const fullPath = path.join(dir, file);
        let stat;
        try {
            stat = fs.statSync(fullPath);
        } catch (e) { return; }
        
        if (stat.isDirectory()) {
            getFilesForBackup(fullPath, fileList, rootDir);
        } else {
            fileList.push({
                absPath: fullPath,
                relPath: path.relative(rootDir, fullPath).replace(/\\/g, '/') // Ensure forward slashes
            });
        }
    });
    return fileList;
}

// --- Helper: GitHub API Logic ---
async function uploadToGithub(config, res) {
    const { token, owner, repo, branch } = config;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
    
    // Wrapper for GitHub requests
    const ghReq = async (method, url, data) => {
        try {
            return await axios({ 
                method, 
                url: `https://api.github.com/repos/${owner}/${repo}${url}`, 
                data, 
                headers,
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            });
        } catch (e) {
            const msg = e.response?.data?.message || e.message;
            throw new Error(msg); 
        }
    };

    try {
        logInfo(`Starting GitHub backup to ${owner}/${repo} [${branch}]...`);
        
        // 1. Scan files
        const files = getFilesForBackup(projectRoot);
        logInfo(`Found ${files.length} files to upload (Sensitive files excluded).`);

        if (files.length === 0) {
            throw new Error("No eligible files found to backup.");
        }

        let latestCommitSha;
        let baseTreeSha;

        // 2. Check if Repository/Branch exists and get HEAD
        try {
            const refRes = await ghReq('GET', `/git/ref/heads/${branch}`);
            latestCommitSha = refRes.data.object.sha;
            
            // Get base tree
            const commitRes = await ghReq('GET', `/git/commits/${latestCommitSha}`);
            baseTreeSha = commitRes.data.tree.sha;
            
        } catch (error) {
            // Handle Empty Repository or Missing Branch
            logWarning(`Branch check failed (${error.message}). Checking if repo is empty...`);

            try {
                const repoRes = await ghReq('GET', ''); // Check repo details
                
                // If repo is empty (size 0), we MUST initialize it with Content API first
                if (repoRes.data.size === 0) {
                    logInfo("Repository is empty. Initializing with the first file...");
                    
                    const firstFile = files[0];
                    const content = fs.readFileSync(firstFile.absPath);
                    const contentBase64 = content.toString('base64');
                    
                    // Use Content API to create initial commit
                    const initRes = await ghReq('PUT', `/contents/${firstFile.relPath}`, {
                        message: "Initial commit by Bot FastUpdate",
                        content: contentBase64,
                        branch: branch
                    });

                    latestCommitSha = initRes.data.commit.sha;
                    baseTreeSha = initRes.data.commit.tree.sha;
                    
                    // Remove the uploaded file from the list to prevent re-uploading immediately
                    files.shift();
                    logSuccess("Repository initialized.");
                } else {
                    throw new Error(`Branch '${branch}' does not exist and repository is not empty. Please create the branch '${branch}' on GitHub first.`);
                }
            } catch (initError) {
                throw new Error(`Failed to initialize repository: ${initError.message}`);
            }
        }

        // 3. Upload Blobs (File Contents)
        const treeItems = [];
        let processed = 0;
        
        for (const file of files) {
            try {
                const content = fs.readFileSync(file.absPath);
                const contentBase64 = content.toString('base64');
                
                const blobRes = await ghReq('POST', '/git/blobs', {
                    content: contentBase64,
                    encoding: 'base64'
                });
                
                treeItems.push({
                    path: file.relPath,
                    mode: '100644',
                    type: 'blob',
                    sha: blobRes.data.sha
                });
                
                processed++;
                if (processed % 10 === 0) logInfo(`Uploaded blobs: ${processed}/${files.length}`);
            } catch (err) {
                logError(`Failed to upload blob for ${file.relPath}: ${err.message}`);
                throw new Error(`Failed on file ${file.relPath}: ${err.message}`);
            }
        }

        if (treeItems.length === 0 && files.length === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: `Backup successful (Initialized with 1 file).` }));
            return;
        }

        // 4. Create new Tree
        const treeRes = await ghReq('POST', '/git/trees', {
            base_tree: baseTreeSha,
            tree: treeItems
        });
        const newTreeSha = treeRes.data.sha;

        // 5. Create Commit
        const newCommitRes = await ghReq('POST', '/git/commits', {
            message: `Backup via Bot FastUpdate: ${new Date().toLocaleString()}`,
            tree: newTreeSha,
            parents: [latestCommitSha]
        });
        const newCommitSha = newCommitRes.data.sha;

        // 6. Update Reference (Move branch pointer)
        await ghReq('PATCH', `/git/refs/heads/${branch}`, {
            sha: newCommitSha
        });

        logSuccess('GitHub backup completed successfully.');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: `Backup successful! Uploaded/Updated ${processed} files.` }));

    } catch (error) {
        logError(`GitHub Backup failed: ${error.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

// --- Context Generation Logic ---
function generateProjectContext() {
    const ignoreDirs = ['node_modules', '.git', 'auth_info_baileys'];
    const ignoreFiles = ['package-lock.json', 'konteks.txt', 'firebase-key.json']; // Added key to context ignore too
    const allowedExts = ['.js', '.json', '.html'];
    
    let context = 'Project structure context for AI.\nBase path is the root of the project.\n\n';

    function walk(dir) {
        let results = [];
        try {
            const list = fs.readdirSync(dir);
            list.forEach(file => {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                if (stat && stat.isDirectory()) {
                    if (!ignoreDirs.includes(file)) {
                        results = results.concat(walk(fullPath));
                    }
                } else {
                    if (!ignoreFiles.includes(file) && allowedExts.includes(path.extname(file))) {
                        results.push(fullPath);
                    }
                }
            });
        } catch (error) {
            logError(`Error walking directory ${dir}: ${error.message}`);
        }
        return results;
    }

    const files = walk(projectRoot);
    files.forEach(filePath => {
        try {
            const relativePath = path.relative(projectRoot, filePath);
            const content = fs.readFileSync(filePath, 'utf8');
            context += `---START OF ${relativePath}---\n${content}\n---END OF ${relativePath}---\n\n`;
        } catch (error) {
            logError(`Error reading file ${filePath}: ${error.message}`);
        }
    });

    return context.trim();
}

// --- Update Application Logic ---
function applyUpdateAndRestart(body, res) {
    try {
        let decodedBody;
        try {
            decodedBody = Buffer.from(body, 'base64').toString('utf8');
        } catch (decodeError) {
            decodedBody = body;
            logWarning('Failed to decode base64, using plain text fallback');
        }

        const codeBlockRegex = /```(?:js|javascript)?\s*\n?([\s\S]*?)```/g;
        const codeBlocks = [];
        let match;
        
        while ((match = codeBlockRegex.exec(decodedBody)) !== null) {
            if (match[1] && match[1].trim()) {
                codeBlocks.push(match[1].trim());
            }
        }

        if (codeBlocks.length === 0) {
            const pathDirectives = decodedBody.split('\n').filter(line => line.includes('// @path'));
            if (pathDirectives.length > 0) {
                codeBlocks.push(decodedBody.trim());
            }
        }

        if (codeBlocks.length === 0) {
            throw new Error("No valid code blocks found in the AI response.");
        }

        let changesMade = 0;
        let errors = [];

        codeBlocks.forEach((block, index) => {
            try {
                const lines = block.split('\n');
                let pathLine = null;
                let typeLine = null;
                
                for (const line of lines) {
                    if (line.includes('// @path') && !pathLine) pathLine = line.trim();
                    if (line.includes('// @type') && !typeLine) typeLine = line.trim();
                    if (pathLine && typeLine) break;
                }

                if (!pathLine || !typeLine) {
                    errors.push(`Block ${index + 1}: Missing // @path or // @type directive`);
                    return;
                }

                const pathMatch = pathLine.match(/\/\/\s*@path\s+(.+)/);
                const typeMatch = typeLine.match(/\/\/\s*@type\s+(.+)/);

                if (!pathMatch || !pathMatch[1] || !typeMatch || !typeMatch[1]) {
                    errors.push(`Block ${index + 1}: Invalid directive format`);
                    return;
                }

                const filePath = path.join(projectRoot, pathMatch[1].trim());
                const type = typeMatch[1].trim();
                
                if (!['write', 'delete'].includes(type)) {
                    errors.push(`Block ${index + 1}: Invalid // @type. Must be 'write' or 'delete', got: ${type}`);
                    return;
                }

                const normalizedPath = path.normalize(filePath);
                if (!normalizedPath.startsWith(projectRoot)) {
                    errors.push(`Block ${index + 1}: Invalid file path - path traversal detected: ${pathMatch[1]}`);
                    return;
                }

                if (type === 'write') {
                    const contentStartIndex = lines.findIndex(line => !line.trim().startsWith('// @'))
                    const code = lines.slice(contentStartIndex).join('\n').trim();

                    if (!code) {
                        errors.push(`Block ${index + 1}: No code provided for write operation`);
                        return;
                    }

                    fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, code);
                    logSuccess(`Applied 'write' to: ${path.relative(projectRoot, filePath)}`);
                    changesMade++;
                    
                } else if (type === 'delete') {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        logSuccess(`Applied 'delete' to: ${path.relative(projectRoot, filePath)}`);
                        changesMade++;
                    } else {
                        logWarning(`File to delete not found: ${path.relative(projectRoot, filePath)}`);
                    }
                }
            } catch (blockError) {
                errors.push(`Block ${index + 1}: ${blockError.message}`);
            }
        });

        if (errors.length > 0) {
            logWarning(`Some blocks had errors:\n${errors.join('\n')}`);
        }

        if (changesMade > 0) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(`Update applied successfully to ${changesMade} file(s). Bot is shutting down for restart.`);
            logInfo("Update successful. Shutting down...");
            setTimeout(() => process.exit(0), 1000);
        } else {
            throw new Error("No valid operations were performed. " + (errors.length > 0 ? `Errors:\n${errors.join('\n')}` : "Check the AI response format."));
        }
    } catch (error) {
        logError(`Update failed: ${error.message}`);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Update failed: ${error.message}`);
    }
}

function serveStaticFile(res, filePath, contentType) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end(`Not Found: ${path.basename(filePath)}`);
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

function startDevServer() {
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            serveStaticFile(res, path.join(projectRoot, 'fastupdate.html'), 'text/html');
        } else if (req.url === '/download') {
            const context = generateProjectContext();
            res.writeHead(200, {
                'Content-Type': 'text/plain',
                'Content-Disposition': 'attachment; filename="konteks.txt"'
            });
            res.end(context);
        } else if (req.url === '/update' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => applyUpdateAndRestart(body, res));
        } else if (req.url === '/github-backup' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const config = JSON.parse(body);
                    uploadToGithub(config, res);
                } catch (e) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, message: "Invalid JSON body" }));
                }
            });
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.listen(7334, '0.0.0.0', () => {
        logInfo('Bot Fast Update server is running on http://localhost:7334');
    });
}

module.exports = { startDevServer };