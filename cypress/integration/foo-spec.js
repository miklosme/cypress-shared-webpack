import pick from 'lodash.pick'

const data = { x: 'foo', y: 'bar', z: 'baz' }
const picked = JSON.stringify(pick(data, ['x']));

// () => debugger;

console.log('ok')

describe('foo', () => {
    it('should be ok', () => {
        cy.visit('/')
        cy.contains(picked);
    });
});
