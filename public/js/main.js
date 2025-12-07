const showMenu = (toggleId, navbarId, bodyId) => {
    const toggle = document.getElementById(toggleId);
    const navbar = document.getElementById(navbarId);
    const bodypadding = document.getElementById(bodyId);

    if(toggle && navbar) {
        toggle.addEventListener('click', () => {
            navbar.classList.toggle('expander');

            bodypadding.classList.toggle('body-pd');
        })
    }
}

showMenu('nav-toggle','navbar', 'body-pd');

// Changing Active Link

const linkColor = document.querySelectorAll('.nav-link');
function colorLink() {
    linkColor.forEach(l => l.classList.remove('active'));
    this.classList.add('active');
}

linkColor.forEach(l => l.addEventListener('click', colorLink));

//Activating Submenus

const linkCollapse = document.getElementsByClassName('collapse-link');
var i

for(i = 0; i <linkCollapse.length; i++) {
    linkCollapse[i].addEventListener('click', function() {
        const collapseMenu = this.nextElementSibling;
        collapseMenu.classList.toggle('showCollapse');

        const rotate = collapseMenu.previousElementSibling;
        rotate.classList.toggle('rotate');
    })
}