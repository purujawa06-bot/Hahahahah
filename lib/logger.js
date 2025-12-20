const chalk = require('chalk');

const log = console.log;

function logInfo(message) {
    log(chalk.blue('[INFO]'), message);
}

function logSuccess(message) {
    log(chalk.green('[SUCCESS]'), message);
}

function logWarning(message) {
    log(chalk.yellow('[WARNING]'), message);
}

function logError(message) {
    log(chalk.red('[ERROR]'), message);
}

module.exports = {
    logInfo,
    logSuccess,
    logWarning,
    logError
};