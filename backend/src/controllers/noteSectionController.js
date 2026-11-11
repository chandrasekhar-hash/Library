/**
 * Note Section & Notebook Controller for Aks (अक्स)
 *
 * Implements:
 * - User-owned personal note sections / notebooks
 * - Auto-seeding of default sections (Daily Journal, Personal, Ideas, Work) on first access
 * - Section creation, renaming, reordering, and safe deletion (unlinking notes without data loss)
 * - Strict multi-tenant isolation
 */

import { prisma } from '../services/prisma.js';
import { isValidUuid } from '../utils/validators.js';

export const DEFAULT_SECTIONS = [
  { name: 'Daily Journal', color: '#e7c18a', icon: 'calendar', order: 0 },
  { name: 'Personal', color: '#67b8a2', icon: 'user', order: 1 },
  { name: 'Ideas', color: '#f59e0b', icon: 'lightbulb', order: 2 },
  { name: 'Work', color: '#60a5fa', icon: 'briefcase', order: 3 },
];

/**
 * GET /api/notes/sections
 * List all personal sections for the authenticated user.
 * Auto-seeds default sections if user has no sections yet.
 */
export async function listSections(req, res, next) {
  try {
    const userId = req.resourceUserId || req.userId;

    let sections = await prisma.noteSection.findMany({
      where: { userId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    // Auto-seed defaults if brand new user and not in read-only owner access
    if (sections.length === 0 && !req.ownerAccessContext) {
      for (let i = 0; i < DEFAULT_SECTIONS.length; i++) {
        const def = DEFAULT_SECTIONS[i];
        await prisma.noteSection.upsert({
          where: {
            userId_name: {
              userId,
              name: def.name,
            },
          },
          update: {},
          create: {
            userId,
            name: def.name,
            color: def.color,
            icon: def.icon,
            order: i,
          },
        });
      }

      sections = await prisma.noteSection.findMany({
        where: { userId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      });
    }

    // Attach note counts per section
    const counts = await prisma.note.groupBy({
      by: ['sectionId'],
      where: { userId },
      _count: { id: true },
    });

    const countMap = new Map();
    for (const c of counts) {
      if (c.sectionId) {
        countMap.set(c.sectionId, c._count.id);
      }
    }

    const enriched = sections.map((s) => ({
      ...s,
      noteCount: countMap.get(s.id) || 0,
    }));

    return res.status(200).json({
      sections: enriched,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/notes/sections
 * Create a new custom section for the user.
 */
export async function createSection(req, res, next) {
  try {
    const userId = req.userId;
    const { name, color, icon } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        error: {
          message: 'Section name is required and cannot be empty.',
          code: 'INVALID_SECTION_NAME',
        },
      });
    }

    const cleanName = name.trim().slice(0, 80);

    // Check for duplicate name
    const existing = await prisma.noteSection.findUnique({
      where: {
        userId_name: {
          userId,
          name: cleanName,
        },
      },
    });

    if (existing) {
      return res.status(409).json({
        error: {
          message: `A section named "${cleanName}" already exists.`,
          code: 'SECTION_ALREADY_EXISTS',
        },
      });
    }

    // Determine next order value
    const maxOrderSection = await prisma.noteSection.findFirst({
      where: { userId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = (maxOrderSection?.order ?? -1) + 1;

    const section = await prisma.noteSection.create({
      data: {
        userId,
        name: cleanName,
        color: color ? String(color).slice(0, 30) : '#e7c18a',
        icon: icon ? String(icon).slice(0, 50) : 'folder',
        order: nextOrder,
      },
    });

    return res.status(201).json({
      message: 'Section created successfully.',
      section: {
        ...section,
        noteCount: 0,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/notes/sections/:sectionId
 * Rename or update an owned section.
 */
export async function updateSection(req, res, next) {
  try {
    const { sectionId } = req.params;
    const userId = req.userId;
    const { name, color, icon, order } = req.body;

    if (!isValidUuid(sectionId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid section ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    const existing = await prisma.noteSection.findFirst({
      where: { id: sectionId, userId },
    });

    if (!existing) {
      return res.status(404).json({
        error: {
          message: 'Section not found or access denied.',
          code: 'SECTION_NOT_FOUND',
        },
      });
    }

    const updateData = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          error: {
            message: 'Section name cannot be empty.',
            code: 'INVALID_SECTION_NAME',
          },
        });
      }
      const cleanName = name.trim().slice(0, 80);
      if (cleanName !== existing.name) {
        const nameConflict = await prisma.noteSection.findUnique({
          where: {
            userId_name: {
              userId,
              name: cleanName,
            },
          },
        });
        if (nameConflict) {
          return res.status(409).json({
            error: {
              message: `A section named "${cleanName}" already exists.`,
              code: 'SECTION_ALREADY_EXISTS',
            },
          });
        }
        updateData.name = cleanName;
      }
    }

    if (color !== undefined) {
      updateData.color = color ? String(color).slice(0, 30) : null;
    }

    if (icon !== undefined) {
      updateData.icon = icon ? String(icon).slice(0, 50) : null;
    }

    if (order !== undefined) {
      const parsedOrder = parseInt(order, 10);
      if (!isNaN(parsedOrder)) {
        updateData.order = parsedOrder;
      }
    }

    const updated = await prisma.noteSection.update({
      where: { id: sectionId },
      data: updateData,
    });

    return res.status(200).json({
      message: 'Section updated successfully.',
      section: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/notes/sections/:sectionId
 * Delete an owned section. Unlinks all contained notes (setting sectionId to null)
 * to ensure zero data loss.
 */
export async function deleteSection(req, res, next) {
  try {
    const { sectionId } = req.params;
    const userId = req.userId;

    if (!isValidUuid(sectionId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid section ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    const existing = await prisma.noteSection.findFirst({
      where: { id: sectionId, userId },
    });

    if (!existing) {
      return res.status(404).json({
        error: {
          message: 'Section not found or access denied.',
          code: 'SECTION_NOT_FOUND',
        },
      });
    }

    // 1. Unlink notes belonging to this section
    await prisma.note.updateMany({
      where: { sectionId, userId },
      data: { sectionId: null },
    });

    // 2. Delete the section
    await prisma.noteSection.delete({
      where: { id: sectionId },
    });

    return res.status(200).json({
      message: 'Section deleted successfully. Any contained notes have been preserved.',
      id: sectionId,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/notes/sections/reorder
 * Reorder sections by updating order indices.
 */
export async function reorderSections(req, res, next) {
  try {
    const userId = req.userId;
    const { sectionIds } = req.body;

    if (!Array.isArray(sectionIds)) {
      return res.status(400).json({
        error: {
          message: 'sectionIds array is required.',
          code: 'INVALID_PAYLOAD',
        },
      });
    }

    // Update orders in a transaction
    await prisma.$transaction(
      sectionIds.map((id, index) =>
        prisma.noteSection.updateMany({
          where: { id, userId },
          data: { order: index },
        })
      )
    );

    const updated = await prisma.noteSection.findMany({
      where: { userId },
      orderBy: { order: 'asc' },
    });

    return res.status(200).json({
      message: 'Sections reordered successfully.',
      sections: updated,
    });
  } catch (err) {
    next(err);
  }
}

