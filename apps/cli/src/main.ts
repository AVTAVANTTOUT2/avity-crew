export function main(args = process.argv.slice(2)): number {
  if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
    console.log(
      'Avity Crew 0.1.0 — équipe locale Claude Code / Codex\n\nUsage: avity-crew [--help | --version]\n\nSocle de développement : orchestration et sessions produit pas encore implémentées.',
    );
    return 0;
  }
  if (args[0] === '--version') {
    console.log('0.1.0');
    return 0;
  }
  console.error(`Commande inconnue ou pas encore implémentée : ${args[0]}`);
  return 2;
}
