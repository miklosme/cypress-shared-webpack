const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin');
const { getChangedFilesForRoots } = require('jest-changed-files');
const path = require('path');
const ipc = require('node-ipc');
const fs = require('fs');
const chalk = require('chalk');
const debug = require('debug')('cypress:shared-webpack');
debug.log = console.log.bind(console);

function onPreprocess() {
    ipc.config.id = 'CypressPreprocessor';
    ipc.config.silent = !(process.env.DEBUG || '').includes('cypress:shared-webpack');

    ipc.connectTo('CypressSharedWebpackServer');

    const requests = {};
    let nextRequestId = 0;

    ipc.of['CypressSharedWebpackServer'].on('onFileResponse', data => {
        requests[data.requestId].call(null, data);
    });

    const watching = {};

    ipc.of['CypressSharedWebpackServer'].on('onRerun', data => {
        if (watching[data.filePath]) {
            watching[data.filePath].call(null);
        }
    });

    return file => {
        const { filePath: encodedFilePath, outputPath, shouldWatch } = file;
        // Cypress passes filePath in encoded form, but Webpack uses unencoded
        const filePath = decodeURIComponent(encodedFilePath);
        const requestId = nextRequestId++;

        ipc.of['CypressSharedWebpackServer'].emit('onFileRequest', {
            id: 'CypressPreprocessor',
            requestId,
            filePath,
            outputPath,
            shouldWatch,
        });

        if (shouldWatch) {
            watching[filePath] = () => {
                file.emit('rerun');
            };
        }

        return new Promise((resolve, reject) => {
            requests[requestId] = data => {
                if (data.error) {
                    debug('preprocessing file is failed:', chalk.red(filePath), data.error);
                    reject(data.error);
                    return;
                }

                debug('preprocessing was successful for', chalk.green(data.transpiledPath));

                resolve(data.transpiledPath);
            };
        });
    };
}

class CypressSharedWebpackPlugin {
    constructor(options = {}) {
        this.compilationError = null;
        this.assets = {};
        this.rerunMap = {};
    }
    apply(compiler) {
        ipc.config.id = 'CypressSharedWebpackServer';
        ipc.config.silent = !(process.env.DEBUG || '').includes('cypress:shared-webpack');

        ipc.serve();

        ipc.server.on('onFileRequest', async (data, socket) => {
            try {
                if (data.shouldWatch) {
                    this.rerunMap[data.filePath] = () => {
                        ipc.server.emit(socket, 'onRerun', {
                            id: 'CypressSharedWebpackServer',
                            filePath: data.filePath,
                        });
                    };
                }

                if (!this.assets[data.filePath]) {
                    await this.compileCypressFile(compiler, data.filePath);
                }

                if (this.compilationError) {
                    throw this.compilationError;
                }

                const asset = this.assets[data.filePath];

                if (!asset) {
                    throw Error(`[CypressSharedWebpackPlugin] compiled asset cannot be found`);
                }

                await new Promise((resolve, reject) => {
                    fs.writeFile(data.outputPath, asset, error => {
                        if (error) {
                            reject(error);
                            return;
                        }

                        debug('file written to:', chalk.bold.green(data.outputPath));

                        resolve();
                    });
                });

                ipc.server.emit(socket, 'onFileResponse', {
                    id: 'CypressSharedWebpackServer',
                    requestId: data.requestId,
                    transpiledPath: data.outputPath,
                });
            } catch (error) {
                ipc.server.emit(socket, 'onFileResponse', {
                    id: 'CypressSharedWebpackServer',
                    requestId: data.requestId,
                    error: {
                        message: error.message,
                    },
                });
            }
        });

        ipc.server.start();

        compiler.hooks.afterCompile.tap('after-compile', compilation => {
            compilation.contextDependencies.add(path.resolve('./cypress/support'));
            compilation.contextDependencies.add(path.resolve('./cypress/integration'));
        });

        // at the first run we compile the support file and some modified tests
        // this gives a little bit of extra confort to the user, because the Cypress tests runner will start immediately
        let firstMakeHook = true;
        compiler.hooks.make.tapAsync('CypressSharedWebpackPlugin', async (compilation, callback) => {
            if (!firstMakeHook) {
                callback();
                return;
            }

            firstMakeHook = false;

            try {
                await this.compileCypressFile(compiler, path.resolve('./cypress/support/index.js'));

                const { changedFiles: changedFilesSet } = await getChangedFilesForRoots(
                    [path.resolve('./cypress/integration')],
                    {
                        withAncestor: true,
                    },
                );

                // remove deleted files
                const changedFiles = Array.from(changedFilesSet).filter(file => fs.existsSync(file));

                // only passing maximum of 10 files to the watched files set,
                // so when many files changed (because of moving around folders for example)
                // webpack won't process too much files unneccesarily
                // files missed here will be handled by the on-demand way when Cypress requests them
                const limitedChangedFiles = changedFiles.slice(0, 3);

                await Promise.all(
                    limitedChangedFiles.map(changedFile => this.compileCypressFile(compiler, changedFile)),
                );
            } catch (error) {
                callback(error);
                return;
            }

            callback();
        });

        compiler.hooks.watchRun.tap('watchRun', compilation => {
            const changedFiles = Object.entries(compilation.watchFileSystem.watcher.mtimes)
                .filter(([key, value]) => value) // deleted files have null as value here
                .map(([key]) => key);

            changedFiles.forEach(changedFile => {
                this.compileCypressFile(compiler, changedFile);
            });
        });
    }
    async compileCypressFile(compiler, entry) {
        debug('running compilation for entry:', entry);
        const firstRun = !this.assets[entry];
        delete this.assets[entry];

        const compilation = compiler.createCompilation();
        const childCompiler = compilation.createChildCompiler('CypressSharedWebpackPlugin', {
            filename: '[name]',
        });

        childCompiler.context = compiler.context;

        new SingleEntryPlugin(
            compiler.context,
            entry,
            entry, // name
        ).apply(childCompiler);

        return new Promise((resolve, reject) => {
            childCompiler.runAsChild((error, entries, childCompilation) => {
                if (error) {
                    debug('error happened when compiling file:', chalk.red(entry), error);
                    reject(error);
                    return;
                }

                const [{ source }] = childCompilation.getAssets();
                this.assets[entry] = source.source();

                debug('file added to assets:', entry);

                if (!firstRun && this.rerunMap[entry]) {
                    this.rerunMap[entry].call(null);
                }

                if (childCompilation.errors.length > 0) {
                    this.compilationError = childCompilation.errors[0];
                    debug(
                        'running compiler succeeded, but compilation error happened:',
                        chalk.red(entry),
                        this.compilationError,
                    );
                    resolve();
                    return;
                }

                debug('compilation finished with no issues for entry:', entry);

                this.compilationError = null;
                resolve();
            });
        });
    }
}

module.exports.CypressSharedWebpackPlugin = CypressSharedWebpackPlugin;
module.exports.onPreprocess = onPreprocess;
