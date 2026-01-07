const fs = require('fs');
const path = require('path');
const { logInfo, logError } = require('./logger');

const plugins = new Map();
const pluginDir = path.join(__dirname, '../plugins');

/**
 * Helper to recursively read directory
 */
function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function(file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            if (path.extname(file) === '.js') {
                arrayOfFiles.push(path.join(dirPath, file));
            }
        }
    });

    return arrayOfFiles;
}

/**
 * Loads all plugins from the plugins directory.
 */
function loadPlugins() {
    plugins.clear();
    
    if (!fs.existsSync(pluginDir)) {
        fs.mkdirSync(pluginDir, { recursive: true });
        // Create default structure if empty
        const mainDir = path.join(pluginDir, 'main');
        if (!fs.existsSync(mainDir)) fs.mkdirSync(mainDir, { recursive: true });
    }

    try {
        const files = getAllFiles(pluginDir);
        
        files.forEach(file => {
            try {
                // Delete cache to allow hot-reloading
                delete require.cache[require.resolve(file)];
                const plugin = require(file);
                
                if (plugin.cmd && plugin.run) {
                    const cmds = Array.isArray(plugin.cmd) ? plugin.cmd : [plugin.cmd];
                    cmds.forEach(cmd => {
                        plugins.set(cmd, {
                            ...plugin,
                            filePath: file
                        });
                    });
                }
            } catch (err) {
                logError(`Failed to load plugin ${path.basename(file)}: ${err.message}`);
            }
        });

        logInfo(`Plugin System Loaded: ${plugins.size} commands active.`);
    } catch (e) {
        logError(`Error reading plugins directory: ${e.message}`);
    }
}

/**
 * Retrieves a specific plugin by command name.
 */
function getPlugin(command) {
    return plugins.get(command);
}

/**
 * Retrieves all plugins (for menu display).
 */
function getAllPlugins() {
    return plugins;
}

module.exports = {
    loadPlugins,
    getPlugin,
    getAllPlugins
};