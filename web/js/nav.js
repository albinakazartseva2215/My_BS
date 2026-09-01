// Мобильное меню шапки — общее для всех страниц web/ (в прототипе у
// кнопки-бургера не было логики вообще, см. landing.js/history; здесь
// минимальный раскрывающийся список, иначе на мобильном экране навигация
// была бы недоступна). Вынесено сюда из landing.js, чтобы не дублировать
// в каждом новом экране (login/register/password-reset/account).

export function closeMobileNav() {
  const nav = document.getElementById('mobileNav');
  const burger = document.getElementById('burgerButton');
  if (!nav || !burger) return;
  nav.classList.remove('is-open');
  burger.setAttribute('aria-expanded', 'false');
}

export function wireMobileMenu() {
  const burger = document.getElementById('burgerButton');
  const nav = document.getElementById('mobileNav');
  if (!burger || !nav) return;
  burger.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(isOpen));
  });
}
