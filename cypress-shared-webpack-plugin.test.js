const { spawn } = require('child_process');
const { onPreprocess } = require('./cypress-shared-webpack-plugin');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

process.env.NODE_ENV = 'test';

process.on('unhandledRejection', err => {
    throw err;
});

let webpackProcess;
let webpackProcessStdout = '';
let preprocessor;

const addedFiles = [];

async function addFile(filePath, content) {
    const fullPath = path.resolve(filePath);
    await fs.writeFile(fullPath, content);
    if (addedFiles.indexOf(fullPath) === -1) {
        addedFiles.push(fullPath);
    }
}

beforeAll(async () => {
    await addFile('./cypress/integration/changed-spec.js', '// empty');

    webpackProcess = spawn('node', ['cypress.js']);

    await new Promise((resolve, reject) => {
        webpackProcess.stdout.on('data', data => {
            const stdout = data.toString();
            webpackProcessStdout += stdout;
            webpackProcessStdout += '\n';

            if (stdout.includes('First compilation is done.')) {
                resolve();
            }
        });

        webpackProcess.stderr.on('data', reject);
    });

    preprocessor = onPreprocess();
});

afterAll(async () => {
    webpackProcess.kill();

    await new Promise(resolve => {
        webpackProcess.on('close', resolve);
    });

    addedFiles.forEach(file => {
        fs.unlink(file);
    });
});

function createFile(relativePath, options = {}) {
    const waiters = [];
    return {
        // encodeURI simulates how Cypress handles non-websafe filepaths
        filePath: encodeURI(path.resolve(relativePath)),
        outputPath: path.resolve(os.tmpdir(), path.basename(relativePath)),
        shouldWatch: options.shouldWatch,
        emit: jest.fn(() => {
            waiters.forEach(fn => fn());
        }),
        waitTillNextEmit() {
            return new Promise(resolve => {
                waiters.push(resolve);
            });
        },
    };
}

function fileAddedMessage(filePath) {
    return `[CypressSharedWebpackPlugin] file added to assets: ${filePath}`;
}

async function getContent(preprocessPromise) {
    const outputPath = await preprocessPromise;
    const buffer = await fs.readFile(outputPath);
    return buffer.toString();
}

test('transpiles the support file at startup', () => {
    const filePath = path.resolve('./cypress/support/index.js');
    expect(webpackProcessStdout.includes(fileAddedMessage(filePath))).toBe(true);
});

test('transpiles (few) changed files at startup', () => {
    const filePath = path.resolve('./cypress/integration/changed-spec.js');
    expect(webpackProcessStdout.includes(fileAddedMessage(filePath))).toBe(true);
});

test('transpiles a file on request', async () => {
    const filePath = path.resolve('./cypress/integration/bar-spec.js');
    expect(webpackProcessStdout.includes(fileAddedMessage(filePath))).toBe(false);

    const file = createFile('./cypress/integration/bar-spec.js');

    const content = await getContent(preprocessor(file));

    expect(content.includes("console.log('bar-spec-helper');")).toBe(true);
    expect(content.includes("console.log('bar-spec');")).toBe(true);
});

test('emits the file rerun event when a file is edited', async () => {
    await addFile('./cypress/integration/rerun-spec.js', "console.log('empty');");

    const file = createFile('./cypress/integration/rerun-spec.js', { shouldWatch: true });

    await preprocessor(file);

    await fs.appendFile(path.resolve('./cypress/integration/rerun-spec.js'), "\nconsole.log('appended');");

    await file.waitTillNextEmit();

    expect(file.emit.mock.calls[0][0]).toBe('rerun');

    const content = await getContent(preprocessor(file));

    expect(content.includes("console.log('appended');")).toBe(true);
});

test('supports filesnames with non-websafe characters', async () => {
    await addFile('./cypress/integration/my not websafe filename.js', "console.log('empty');");

    const file = createFile('./cypress/integration/my not websafe filename.js');

    const content = await getContent(preprocessor(file));

    expect(content.includes("console.log('empty');")).toBe(true);
});

test('handles and recovers from compilation errors', async () => {
    const filePath = './cypress/integration/error-spec.js';

    await addFile(filePath, '() => debugger;'); // this is syntax-invalid code

    const file = createFile(filePath, { shouldWatch: true });

    await expect(preprocessor(file)).rejects.toThrowErrorMatchingInlineSnapshot(`
"Module parse failed: Unexpected token (1:6)
You may need an appropriate loader to handle this file type, currently no loaders are configured to process this file. See https://webpack.js.org/concepts#loaders
> () => debugger;"
`);

    await addFile(filePath, "console.log('valid');");

    await file.waitTillNextEmit();

    const content = await getContent(preprocessor(file));

    expect(content.includes("console.log('valid');")).toBe(true);
});
