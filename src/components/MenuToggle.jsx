import { useEffect, useState } from 'react';

export default function MenuToggle() {
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        const toggle = document.querySelector('.menu-toggle');
        const menu = document.querySelector('.internal-links');
        const social = document.querySelector('.social-wrapper');

        const focusableElements = 'a[href], button';
        let firstFocusable = null;
        let lastFocusable = null;

        const trapFocus = (e) => {
            if (!menuOpen) return;

            const focusables = document.querySelectorAll(focusableElements);
            firstFocusable = focusables[0];
            lastFocusable = focusables[focusables.length - 1];

            if (e.key === 'Tab') {
                if (e.shiftKey) {
                    // Shift + Tab
                    if (document.activeElement === firstFocusable) {
                        e.preventDefault();
                        lastFocusable.focus();
                    }
                } else {
                    // Tab
                    if (document.activeElement === lastFocusable) {
                        e.preventDefault();
                        firstFocusable.focus();
                    }
                }
            } else if (e.key === 'Escape') {
                closeMenu();
            }
        };

        const openMenu = () => {
            setMenuOpen(true);
            document.body.classList.add('menu-open');
            document.addEventListener('keydown', trapFocus);
        };

        const closeMenu = () => {
            setMenuOpen(false);
            document.body.classList.remove('menu-open');
            document.removeEventListener('keydown', trapFocus);
        };

        const toggleMenu = () => {
            menuOpen ? closeMenu() : openMenu();
        };

        if (toggle) {
            toggle.addEventListener('click', toggleMenu);
        }

        return () => {
            toggle?.removeEventListener('click', toggleMenu);
            document.removeEventListener('keydown', trapFocus);
        };
    }, [menuOpen]);

    return null;
}
