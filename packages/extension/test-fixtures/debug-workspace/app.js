// Prints the dependency bindings Debug Against Environment passed in.
const bindings = Object.entries(process.env).filter(([k]) => /^(DB|GREETER|SERVICE|HTTP|URL|OPENCHOREO)/.test(k));
console.log('Environment from OpenChoreo:', bindings.length ? Object.fromEntries(bindings) : '(no dependencies declared)');
setTimeout(() => console.log('done'), 2000);
