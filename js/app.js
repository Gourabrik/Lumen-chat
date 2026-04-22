document.addEventListener('DOMContentLoaded', () => {
  const navItems = document.querySelectorAll('.nav-item');
  const viewSections = document.querySelectorAll('.view-section');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      // 1. Remove active class from all nav items
      navItems.forEach(nav => nav.classList.remove('active'));
      
      // 2. Add active class to clicked nav item
      item.classList.add('active');

      // 3. Get the view identifier
      const targetView = item.getAttribute('data-view');

      // 4. Hide all views
      viewSections.forEach(section => {
        section.classList.add('hidden');
        section.classList.remove('active');
      });

      // 5. Show the target view
      const targetSection = document.getElementById(`view-${targetView}`);
      if (targetSection) {
        targetSection.classList.remove('hidden');
        // Small delay for smooth transition (optional)
        setTimeout(() => targetSection.classList.add('active'), 50);
      }
    });
  });
});
