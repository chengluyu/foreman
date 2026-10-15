// Rendering only. Pi's original edit definition still executes and returns the
// same model-visible result, including its diff metadata.
export function collapsibleEditRenderer({ Text, Container }) {
  return (toolName, next) => {
    const original = next();
    if (toolName !== 'edit' || !original) return original;
    return {
      ...original,
      renderCall(args, theme, context) {
        if (context.expanded && original.renderCall) return original.renderCall(args, theme, context);
        const file = args?.path ?? args?.file_path ?? '';
        return new Text(`${theme.fg('toolTitle', theme.bold('edit'))} ${file}`, context.outputPad, 0);
      },
      renderResult(result, options, theme, context) {
        if (options.expanded && original.renderResult) {
          return original.renderResult(result, options, theme, context);
        }
        const component = new Container();
        if (context.isError) {
          const error = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
          component.addChild(new Text(theme.fg('error', error || 'Edit failed'), context.outputPad, 0));
        }
        return component;
      },
    };
  };
}
