const [, , command, milestone] = process.argv;
console.error(
  `"${command}" is not implemented yet — it arrives in ${milestone} (docs/IMPLEMENTATION_PLAN.md).`,
);
process.exit(1);
