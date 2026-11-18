/* =====================================================================
   REZENDE ENERGIA — controle do modo claro/escuro  (v1.0)
   Carregue no <head>, ANTES do CSS, para a tela não piscar:
     <script src="js/rezende-tema.js"></script>
   Botão: qualquer elemento com [data-rz-tema] alterna o modo.
   Outros scripts podem ouvir:  window.addEventListener('rz:tema', e => e.detail.tema)
   A escolha vale para todos os sistemas no mesmo endereço (localStorage).
   ===================================================================== */
(function () {
  var CHAVE = 'rz-tema';
  var raiz = document.documentElement;
  var midia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function salvo() { try { return localStorage.getItem(CHAVE); } catch (e) { return null; } }
  function doSistema() { return midia && midia.matches ? 'escuro' : 'claro'; }

  function aplicar(tema, guardar) {
    raiz.setAttribute('data-theme', tema);
    if (guardar) { try { localStorage.setItem(CHAVE, tema); } catch (e) { /* navegador sem storage */ } }
    document.querySelectorAll('[data-rz-tema]').forEach(function (b) {
      b.setAttribute('aria-label', tema === 'escuro' ? 'Mudar para modo claro' : 'Mudar para modo escuro');
      b.setAttribute('title', tema === 'escuro' ? 'Modo claro' : 'Modo escuro');
    });
    window.dispatchEvent(new CustomEvent('rz:tema', { detail: { tema: tema } }));
  }

  aplicar(salvo() || doSistema(), false);

  if (midia && midia.addEventListener) {
    midia.addEventListener('change', function () { if (!salvo()) aplicar(doSistema(), false); });
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-rz-tema]');
    if (!b) return;
    aplicar(raiz.getAttribute('data-theme') === 'escuro' ? 'claro' : 'escuro', true);
  });
  document.addEventListener('DOMContentLoaded', function () { aplicar(raiz.getAttribute('data-theme'), false); });

  /* Lê uma cor do tema atual — útil para Chart.js e afins */
  window.rzCor = function (nome) {
    return getComputedStyle(raiz).getPropertyValue('--' + nome).trim();
  };
  window.rzTema = function () { return raiz.getAttribute('data-theme'); };
})();
