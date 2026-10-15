// @practiceperfect/eslint-config custom rule (Task 9.1).
//
// Lint-time half of arch §9.2's "convert an easy-to-forget convention into a
// build failure" — Task 2.8 (apps/server/src/shared/security/assert-routes-have-capability.ts)
// is the boot-time half, walking Nest's DiscoveryService at application
// startup. This rule catches the same gap statically, before the app even
// runs: a @Controller() class method that carries an HTTP-method decorator
// (@Get/@Post/@Put/@Patch/@Delete/@All/@Head/@Options) must also carry
// @Public() or @RequiresCapability(...), on the method itself or its
// enclosing class — mirroring the runtime check's
// `reflector.getAllAndOverride(KEY, [handler, classRef])` semantics (method
// decorator wins, class decorator is the fallback).

const HTTP_METHOD_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);
const SCOPING_DECORATORS = ['Public', 'RequiresCapability'];

function decoratorName(decorator) {
  const expr = decorator.expression;
  if (expr.type === 'CallExpression' && expr.callee.type === 'Identifier') {
    return expr.callee.name;
  }
  if (expr.type === 'Identifier') {
    return expr.name;
  }
  return undefined;
}

function hasDecorator(decorators, names) {
  return (decorators ?? []).some((decorator) => names.includes(decoratorName(decorator)));
}

function isControllerClass(classNode) {
  return classNode.type === 'ClassDeclaration' && hasDecorator(classNode.decorators, ['Controller']);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Every @Controller() route handler must carry @Public() or @RequiresCapability(...) (arch §9.2 / DoD §20).',
    },
    schema: [],
    messages: {
      missingCapability:
        "Route handler '{{method}}' is neither @Public() nor @RequiresCapability(...) annotated (on itself or its " +
        'controller class). Every non-public route must carry an explicit capability (arch §9.2 / DoD §20) — this ' +
        'is enforced again at boot time by assertRoutesHaveRequiredCapability, but catching it here saves the ' +
        'round trip.',
    },
  },
  create(context) {
    return {
      MethodDefinition(node) {
        const classNode = node.parent?.parent;
        if (!classNode || !isControllerClass(classNode)) {
          return;
        }

        const methodDecorators = node.decorators ?? [];
        const isRouteHandler = methodDecorators.some((decorator) => HTTP_METHOD_DECORATORS.has(decoratorName(decorator)));
        if (!isRouteHandler) {
          return;
        }

        const isScoped =
          hasDecorator(methodDecorators, SCOPING_DECORATORS) || hasDecorator(classNode.decorators, SCOPING_DECORATORS);

        if (!isScoped) {
          context.report({
            node,
            messageId: 'missingCapability',
            data: {
              method: node.key.type === 'Identifier' ? node.key.name : '<computed>',
            },
          });
        }
      },
    };
  },
};
